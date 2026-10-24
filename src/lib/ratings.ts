import { classifyPlayer, PLAYER_CLASS_POLICY } from "./player-class";
import { createHash } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  registrations,
  users,
  captains,
  memberships,
  fixtures as fixtureTable,
  tournamentRounds,
  tournamentStages,
} from "@/db/schema";
import {
  approvedRatingGames,
  type RatingReader,
} from "./approved-rating-games";
import { calculateRating, type RatingGame } from "./yumu-rating";
import { publicCompetition } from "./public-competition";
import { assertReadCapability } from "./auth/staff";
import type { User } from "./auth/sessions";
import { readTournament } from "./tournaments";
import { HttpError } from "./http";

export async function ratingIdentities(
  slug: string,
  reader: RatingReader,
  publicTeamIds?: string[],
) {
  const identities = await reader
    .select({ userId: registrations.userId, username: users.username })
    .from(registrations)
    .innerJoin(users, eq(users.osuId, registrations.userId))
    .where(
      and(
        eq(registrations.editionSlug, slug),
        publicTeamIds ? eq(registrations.status, "accepted") : undefined,
      ),
    );
  if (publicTeamIds) {
    identities.push(
      ...(await reader
        .select({ userId: captains.userId, username: users.username })
        .from(captains)
        .innerJoin(users, eq(users.osuId, captains.userId))
        .where(
          and(eq(captains.editionSlug, slug), eq(captains.published, true)),
        )),
    );
    if (publicTeamIds.length)
      identities.push(
        ...(await reader
          .select({ userId: memberships.userId, username: users.username })
          .from(memberships)
          .innerJoin(users, eq(users.osuId, memberships.userId))
          .where(
            and(
              eq(memberships.editionSlug, slug),
              inArray(memberships.teamId, publicTeamIds),
            ),
          )),
      );
  }
  return new Map(identities.map((p) => [p.userId, p.username]));
}
export function ratingSnapshot(
  games: RatingGame[],
  identities: Map<number, string>,
) {
  const report = calculateRating(games);
  const evidence = [
    ...new Map(
      games.map((g) => [
        g.gameId,
        {
          gameId: g.gameId,
          fixtureId: g.fixtureId,
          revision: g.revision,
          fingerprint: g.approvalFingerprint ?? g.fingerprint,
        },
      ]),
    ).values(),
  ].sort((a, b) => a.gameId - b.gameId);
  const players = report.players.map((p) => ({
    ...p,
    classification: classifyPlayer(p, report.playerCount),
    username: identities.get(p.userId) ?? String(p.userId),
  }));
  return {
    ...report,
    classificationPolicy: PLAYER_CLASS_POLICY,
    players,
    evidence,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([report, evidence, players]))
      .digest("hex"),
  };
}
export async function matchRatingWorkspace(
  actor: User,
  slug: string,
  fixtureId: string,
) {
  await assertReadCapability(actor, "approve_results", slug);
  return db().transaction(
    async (tx) => {
      await assertReadCapability(actor, "approve_results", slug, tx);
      if (!(await readTournament(slug, tx)))
        throw new HttpError(404, "Tournament not found.");
      const games = (await approvedRatingGames(slug, tx)).filter(
        (g) => g.fixtureId === fixtureId,
      );
      return ratingSnapshot(games, await ratingIdentities(slug, tx));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export async function publicMatchRating(slug: string, fixtureId: string) {
  if (!process.env.DATABASE_URL) return null;
  return db().transaction(
    async (tx) => {
      const competition = await publicCompetition(slug, tx);
      const fixture = competition?.fixtures.find(
        (f) => f.id === fixtureId && f.result,
      );
      if (!fixture?.result) return null;
      const identities = await ratingIdentities(slug, tx, [
        fixture.home.team!.id,
        fixture.away.team!.id,
      ]);
      const games = (await approvedRatingGames(slug, tx)).filter(
        (g) =>
          g.fixtureId === fixtureId && g.revision === fixture.result!.revision,
      );
      // No public record may identify a private substitute, even via the source evidence.
      if (games.some((g) => g.scores.some((s) => !identities.has(s.userId))))
        return null;
      return ratingSnapshot(games, identities);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Same population and approval gates as single fixtures, with raw-game reaggregation. */
export async function publicRoundRatings(slug: string) {
  if (!process.env.DATABASE_URL) return [];
  return db().transaction(
    async (tx) => {
      const competition = await publicCompetition(slug, tx);
      if (!competition) return [];
      const fixtures = competition.fixtures.filter(
        (f) => f.status !== "cancelled",
      );
      const identities = await ratingIdentities(slug, tx, [
        ...new Set(
          fixtures.flatMap((f) =>
            [f.home.team?.id, f.away.team?.id].filter(
              (id): id is string => !!id,
            ),
          ),
        ),
      ]);
      const games = await approvedRatingGames(slug, tx);
      const allFixtures = await tx
        .select({ id: fixtureTable.id, roundId: fixtureTable.roundId })
        .from(fixtureTable)
        .where(
          and(
            eq(fixtureTable.editionSlug, slug),
            ne(fixtureTable.status, "cancelled"),
          ),
        );
      return [...new Set(fixtures.map((f) => f.roundId))].flatMap((roundId) => {
        const round = fixtures.filter((f) => f.roundId === roundId);
        const scopes = [
          { key: "", name: "", teamIds: null as string[] | null },
          ...competition.groups.map((g) => ({
            key: g.key,
            name: g.name,
            teamIds: g.rows.map((r) => r.team.id),
          })),
        ];
        return scopes
          .filter((scope) => !scope.key || round[0].stage === "group")
          .flatMap((scope) => {
            const selected = round.filter(
              (f) =>
                !scope.teamIds ||
                (scope.teamIds.includes(f.home.team?.id ?? "") &&
                  scope.teamIds.includes(f.away.team?.id ?? "")),
            );
            if (!selected.length) return [];
            const available = selected.filter((f) => f.result);
            const ids = new Set(available.map((f) => f.id));
            const source = games.filter((g) => ids.has(g.fixtureId));
            const withheld = source.some((g) =>
              g.scores.some((s) => !identities.has(s.userId)),
            );
            const report = ratingSnapshot(withheld ? [] : source, identities);
            const complete =
              available.length === selected.length &&
              !report.issues.length &&
              !withheld &&
              available.every((f) =>
                source.some((g) => g.fixtureId === f.id),
              ) &&
              allFixtures
                .filter((f) => f.roundId === roundId)
                .every((f) => round.some((p) => p.id === f.id));
            return [
              {
                roundId,
                roundName: round[0].roundName,
                stage: round[0].stage,
                groupKey: scope.key,
                groupName: scope.name,
                publishedFixtures: selected.length,
                ratedFixtures: withheld
                  ? 0
                  : available.filter((f) =>
                      source.some((g) => g.fixtureId === f.id),
                    ).length,
                complete,
                report,
              },
            ];
          });
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function staffRoundRatings(
  slug: string,
  reader: RatingReader,
  games: RatingGame[],
  identities: Map<number, string>,
) {
  const rows = await reader
    .select({
      fixture: fixtureTable,
      round: tournamentRounds,
      stage: tournamentStages.kind,
    })
    .from(fixtureTable)
    .innerJoin(tournamentRounds, eq(tournamentRounds.id, fixtureTable.roundId))
    .innerJoin(
      tournamentStages,
      eq(tournamentStages.id, tournamentRounds.stageId),
    )
    .where(
      and(
        eq(fixtureTable.editionSlug, slug),
        ne(fixtureTable.status, "cancelled"),
      ),
    );
  return [...new Set(rows.map((r) => r.round.id))].map((roundId) => {
    const round = rows.filter((r) => r.round.id === roundId);
    const source = games.filter((g) =>
      round.some((r) => r.fixture.id === g.fixtureId),
    );
    const report = ratingSnapshot(source, identities);
    const ratedFixtures = new Set(source.map((g) => g.fixtureId)).size;
    return {
      roundId,
      roundName: round[0].round.name,
      stage: round[0].stage,
      groupKey: "",
      groupName: "",
      publishedFixtures: round.filter((r) => r.fixture.publishedAt).length,
      ratedFixtures,
      complete: ratedFixtures === round.length && !report.issues.length,
      report,
    };
  });
}
