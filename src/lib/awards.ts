import { approvedRatingGames } from "./approved-rating-games";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  awardSettings,
  fixtures,
  captains,
  teams,
  draftSessions,
  draftPicks,
  weeklyAwardReleases,
  editionState,
  editionEvents,
  registrations,
  users,
} from "@/db/schema";
import { assertReadCapability, assertCapability } from "./auth/staff";
import type { User } from "./auth/sessions";
import { HttpError } from "./http";
import { readTournament } from "./tournaments";
import {
  awardConfigurationSchema,
  awardPolicySchema,
  weeklyStandings,
  type AwardWeek,
  type AwardStanding,
} from "./award-model";
import { classifyPlayer, PLAYER_CLASS_POLICY } from "./player-class";
import { staffRoundRatings } from "./ratings";
import { YUMU_POLICY } from "./yumu-rating";
import { draftAwardTiers } from "./award-tiers";
type Reader = Pick<ReturnType<typeof db>, "select">;
export type AwardReport = AwardWeek &
  AwardStanding & {
    policy: string;
    timeZone: string;
    fingerprint: string;
    identities: { userId: number; username: string; public: boolean }[];
  };
async function calculation(slug: string, reader: Reader) {
  const tournament = await readTournament(slug, reader);
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const [stored] = await reader
    .select()
    .from(awardSettings)
    .where(eq(awardSettings.editionSlug, slug));
  const configuration = awardConfigurationSchema.parse({
    weeks: stored?.weeks ?? [],
    policy: stored?.policy ?? YUMU_POLICY,
  });
  const [session] = await reader
    .select()
    .from(draftSessions)
    .where(eq(draftSessions.editionSlug, slug));
  const appointed = await reader
    .select({ id: captains.userId, published: captains.published })
    .from(captains)
    .where(eq(captains.editionSlug, slug));
  const captainTeams = await reader
    .select({ id: teams.captainId })
    .from(teams)
    .where(and(eq(teams.editionSlug, slug), isNull(teams.archivedAt)));
  const captainIds = [...appointed, ...captainTeams].map((c) => c.id);
  const picks =
    session && session.state !== "aborted"
      ? await reader
          .select()
          .from(draftPicks)
          .where(
            and(
              eq(draftPicks.sessionId, session.id),
              isNull(draftPicks.voidedAt),
            ),
          )
      : [];
  const tiers = draftAwardTiers(session?.turnSequence ?? [], picks, captainIds);
  const released = session?.publicSnapshot?.picks ?? [];
  const releasedTiers = draftAwardTiers(
    session?.turnSequence ?? [],
    picks.filter((p) =>
      released.some(
        (r) =>
          r.id === p.id &&
          r.turnIndex === p.turnIndex &&
          r.player.osuId === p.playerId &&
          r.team.id === p.teamId,
      ),
    ),
    appointed.filter((c) => c.published).map((c) => c.id),
  );
  const participants = await reader
    .select({
      userId: registrations.userId,
      username: users.username,
      status: registrations.status,
    })
    .from(registrations)
    .innerJoin(users, eq(users.osuId, registrations.userId))
    .where(eq(registrations.editionSlug, slug));
  const games = await approvedRatingGames(slug, reader);
  const scheduledFixtures =
    configuration.policy === YUMU_POLICY
      ? await reader
          .select({ id: fixtures.id, at: fixtures.scheduledAt })
          .from(fixtures)
          .where(
            and(
              eq(fixtures.editionSlug, slug),
              ne(fixtures.status, "cancelled"),
            ),
          )
      : [];
  const reports = weeklyStandings(
    configuration.weeks,
    tiers,
    games,
    configuration.policy,
  ).map((standing): AwardReport => {
    const identities = standing.candidates.map((c) => {
      const participant = participants.find((p) => p.userId === c.userId);
      return {
        userId: c.userId,
        username: participant?.username ?? String(c.userId),
        public: participant?.status === "accepted",
      };
    });
    const report = {
      ...standing,
      ...(configuration.policy === YUMU_POLICY
        ? {
            classificationPolicy: PLAYER_CLASS_POLICY,
            candidates: standing.candidates.map((c) => ({
              ...c,
              ratingClass: c.rating
                ? classifyPlayer(c.rating, c.ratingPlayerCount ?? 0)
                : null,
            })),
            ratingContext: games
              .filter((g) =>
                standing.evidence.some((e) => e.gameId === g.gameId),
              )
              .map((g) => ({
                gameId: g.gameId,
                roundId: g.roundId,
                approvalFingerprint: g.approvalFingerprint,
              })),
          }
        : {}),
      policy: configuration.policy,
      timeZone: tournament.edition.timeZone,
      identities,
      issues: [
        ...standing.issues,
        ...(configuration.policy === YUMU_POLICY &&
        scheduledFixtures.some(
          (f) =>
            f.at &&
            f.at.getTime() >= Date.parse(standing.startsAt) &&
            f.at.getTime() < Date.parse(standing.endsAt) &&
            !games.some((g) => g.fixtureId === f.id && !g.problem),
        )
          ? [
              "This award week still has fixtures awaiting approved published game data.",
            ]
          : []),
        ...(standing.candidates.some(
          (c) =>
            c.tier !== null &&
            !releasedTiers.some(
              (t) => t.userId === c.userId && t.tier === c.tier,
            ),
        )
          ? ["Release draft Tier sources before publishing awards."]
          : []),
      ],
    };
    return {
      ...report,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(report))
        .digest("hex"),
    };
  });
  const releases = await reader
    .select()
    .from(weeklyAwardReleases)
    .where(
      and(
        eq(weeklyAwardReleases.editionSlug, slug),
        eq(weeklyAwardReleases.active, true),
      ),
    );
  return {
    roundRatings: await staffRoundRatings(
      slug,
      reader,
      games,
      new Map(participants.map((p) => [p.userId, p.username])),
    ),
    edition: {
      slug,
      name: tournament.edition.name,
      timeZone: tournament.edition.timeZone,
    },
    version: stored?.version ?? 0,
    ...configuration,
    tiers,
    participants,
    reports,
    releases,
  };
}
export async function awardWorkspace(actor: User, slug: string) {
  await assertReadCapability(actor, "approve_results", slug);
  return db().transaction((tx) => calculation(slug, tx), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
const common = {
  expectedVersion: z.number().int().nonnegative(),
  confirmed: z.literal(true),
};
const command = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("configure"),
      ...awardConfigurationSchema.shape,
      policy: awardPolicySchema.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("publish"),
      week: z.number().int().positive(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("unpublish"),
      week: z.number().int().positive(),
      releaseId: z.uuid(),
    })
    .strict(),
]);
export async function awardCommand(actor: User, slug: string, input: unknown) {
  const parsed = command.safeParse(input);
  if (!parsed.success)
    throw new HttpError(400, "Invalid award configuration or command.");
  const c = parsed.data;
  await assertCapability(
    actor,
    c.action === "configure" ? "configure_tournament" : "publish_results",
    slug,
  );
  await db().transaction(async (tx) => {
    await tx
      .select({ slug: editionState.slug })
      .from(editionState)
      .where(eq(editionState.slug, slug))
      .for("update");
    await assertCapability(
      actor,
      c.action === "configure" ? "configure_tournament" : "publish_results",
      slug,
      tx,
    );
    const current = await calculation(slug, tx);
    if (current.version !== c.expectedVersion)
      throw new HttpError(
        409,
        "Award configuration changed. Refresh before saving.",
      );
    let before: unknown, after: unknown;
    if (c.action === "configure") {
      const config = awardConfigurationSchema.safeParse({
        weeks: c.weeks,
        policy: c.policy ?? current.policy,
      });
      if (!config.success)
        throw new HttpError(
          400,
          "Configure consecutive, non-overlapping weeks.",
        );
      before = {
        weeks: current.weeks,
        policy: current.policy,
        version: current.version,
      };
      after = { ...config.data, version: current.version + 1 };
      await tx
        .insert(awardSettings)
        .values({
          editionSlug: slug,
          ...config.data,
          version: current.version + 1,
        })
        .onConflictDoUpdate({
          target: awardSettings.editionSlug,
          set: {
            ...config.data,
            version: current.version + 1,
            updatedAt: new Date(),
          },
        });
    } else {
      const active = current.releases.find((r) => r.week === c.week);
      if (c.action === "unpublish") {
        if (!active || active.id !== c.releaseId)
          throw new HttpError(
            409,
            "Award publication changed. Refresh before saving.",
          );
        await tx
          .update(weeklyAwardReleases)
          .set({ active: false })
          .where(eq(weeklyAwardReleases.id, active.id));
        before = { id: active.id, revision: active.revision };
        after = { active: false };
      } else {
        const report = current.reports.find((r) => r.number === c.week);
        if (!report || report.fingerprint !== c.fingerprint)
          throw new HttpError(
            409,
            "Award source data changed. Review the refreshed calculation.",
          );
        if (
          report.issues.includes(
            "Release draft Tier sources before publishing awards.",
          )
        )
          throw new HttpError(
            409,
            "Release draft Tier sources before publishing awards.",
          );
        const winners = new Set([
          ...report.mvp,
          ...report.mip,
          ...report.rookie,
        ]);
        if (
          report.issues.length ||
          [...winners].some(
            (id) => !report.identities.some((p) => p.userId === id && p.public),
          )
        )
          throw new HttpError(
            409,
            "Resolve unverified games and unpublished winner identities before publishing awards.",
          );
        if (active?.fingerprint === report.fingerprint) return;
        if (active)
          await tx
            .update(weeklyAwardReleases)
            .set({ active: false })
            .where(eq(weeklyAwardReleases.id, active.id));
        const [latest] = await tx
          .select({ revision: weeklyAwardReleases.revision })
          .from(weeklyAwardReleases)
          .where(
            and(
              eq(weeklyAwardReleases.editionSlug, slug),
              eq(weeklyAwardReleases.week, c.week),
            ),
          )
          .orderBy(desc(weeklyAwardReleases.revision))
          .limit(1);
        const [release] = await tx
          .insert(weeklyAwardReleases)
          .values({
            editionSlug: slug,
            week: c.week,
            revision: (latest?.revision ?? 0) + 1,
            fingerprint: report.fingerprint,
            report,
            publishedBy: actor.osuId,
          })
          .returning();
        before = active ? { id: active.id, revision: active.revision } : null;
        after = {
          id: release.id,
          revision: release.revision,
          fingerprint: release.fingerprint,
        };
      }
    }
    await tx.insert(editionEvents).values({
      editionSlug: slug,
      actorId: actor.osuId,
      kind: `awards_${c.action}`,
      detail: { entity: { type: "weekly_awards", id: slug }, before, after },
    });
  });
  return awardWorkspace(actor, slug);
}
export async function publicAwards(slug: string) {
  if (!process.env.DATABASE_URL) return null;
  return db().transaction(
    async (tx) => {
      if (!(await readTournament(slug, tx, true))) return null;
      const data = await calculation(slug, tx);
      return data.releases
        .sort((a, b) => a.week - b.week)
        .map((release) => {
          const stale =
            release.fingerprint !==
            data.reports.find((r) => r.number === release.week)?.fingerprint;
          const report = release.report;
          return {
            week: release.week,
            revision: release.revision,
            publishedAt: release.publishedAt.toISOString(),
            stale,
            startsAt: report.startsAt,
            endsAt: report.endsAt,
            timeZone: report.timeZone,
            policy: report.policy,
            candidates: stale
              ? []
              : report.candidates.flatMap((c) => {
                  const identity = report.identities.find(
                    (p) => p.userId === c.userId && p.public,
                  );
                  return identity
                    ? [{ ...c, username: identity.username }]
                    : [];
                }),
            mvp: stale ? [] : report.mvp,
            mip: stale ? [] : report.mip,
            rookie: stale ? [] : report.rookie,
          };
        });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
