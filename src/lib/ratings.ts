import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { registrations, users, captains, memberships } from "@/db/schema";
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
    username: identities.get(p.userId) ?? String(p.userId),
  }));
  return {
    ...report,
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
