import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db";
import {
  fixtures,
  editionState,
  matchResults,
  staffRoles,
  users,
  registrations,
  editionEvents,
  weeklyAwardReleases,
  awardSettings,
  captains,
  draftSessions,
  draftPicks,
} from "../../src/db/schema";
import {
  awardCommand,
  awardWorkspace,
  publicAwards,
} from "../../src/lib/awards";
import { seedEditions } from "../fixtures/editions";
import { seedAwardReview, awardWeeks } from "../fixtures/awards";
import { assertTestDatabase } from "../database";
const url = process.env.TEST_DATABASE_URL;
const admin = { osuId: 113001, username: "Synthetic Admin" },
  referee = { osuId: 113002, username: "Synthetic Referee" };
describe.skipIf(!url)("edition weekly award review and publication", () => {
  beforeAll(() => {
    assertTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("ADMIN_OSU_IDS", String(admin.osuId));
  });
  beforeEach(async () => {
    await db().execute(sql`TRUNCATE edition_state, users CASCADE`);
    await seedEditions();
    await db().insert(users).values([admin, referee]);
  });
  afterAll(async () => {
    await closeDb();
    vi.unstubAllEnvs();
  });
  async function configure() {
    const seeded = await seedAwardReview(admin.osuId, referee.osuId);
    const data = await awardCommand(admin, "test-cup", {
      action: "configure",
      policy: "relative-game-mean-v1",
      confirmed: true,
      expectedVersion: 0,
      weeks: awardWeeks,
    });
    return { seeded, data };
  }
  const publish = (fingerprint: string) =>
    awardCommand(admin, "test-cup", {
      action: "publish",
      confirmed: true,
      expectedVersion: 1,
      week: 1,
      fingerprint,
    });
  it("derives current tiers, excludes captains, blocks unreleased tier sources and follows undo", async () => {
    const { seeded } = await configure();
    const sequence = [seeded.home.teamId, seeded.away.teamId];
    const [session] = await db()
      .insert(draftSessions)
      .values({
        editionSlug: "test-cup",
        state: "live",
        turnIndex: 1,
        turnSequence: sequence,
      })
      .returning();
    const [pick] = await db()
      .insert(draftPicks)
      .values({
        sessionId: session.id,
        playerId: seeded.home.memberId,
        teamId: seeded.home.teamId,
        captainId: seeded.home.captainId,
        actorId: admin.osuId,
        turnIndex: 0,
        mode: "staff_on_behalf",
        requestKey: crypto.randomUUID(),
        requestHash: "synthetic",
        revision: 1,
      })
      .returning();
    let data = await awardWorkspace(admin, "test-cup");
    expect(data.tiers).toContainEqual({
      userId: seeded.home.memberId,
      tier: 1,
    });
    expect(
      data.tiers.find((t) => t.userId === seeded.home.captainId)?.tier,
    ).toBe(0);
    expect(
      data.reports[0].candidates.find((c) => c.userId === seeded.home.captainId)
        ?.tier,
    ).toBe(0);
    await expect(publish(data.reports[0].fingerprint)).rejects.toMatchObject({
      status: 409,
    });
    await db()
      .update(draftSessions)
      .set({
        publishedRevision: 1,
        publicSnapshot: {
          sessionId: session.id,
          version: 1,
          state: "live",
          turnIndex: 1,
          turnCount: sequence.length,
          activeTeam: null,
          picks: [
            {
              id: pick.id,
              turnIndex: 0,
              team: {
                id: seeded.home.teamId,
                name: "Synthetic home",
                captain: {
                  osuId: seeded.home.captainId,
                  username: "Synthetic captain",
                },
              },
              player: {
                osuId: seeded.home.memberId,
                username: "Synthetic member",
              },
            },
          ],
          rosters: [],
          pool: null,
        },
      })
      .where(eq(draftSessions.id, session.id));
    data = await awardWorkspace(admin, "test-cup");
    await publish(data.reports[0].fingerprint);
    expect(
      (await publicAwards("test-cup"))![0].candidates.find(
        (c) => c.userId === seeded.home.memberId,
      )?.tier,
    ).toBe(1);
    await db()
      .update(draftPicks)
      .set({ voidedAt: new Date() })
      .where(eq(draftPicks.id, pick.id));
    data = await awardWorkspace(admin, "test-cup");
    expect(data.tiers.filter((t) => t.tier > 0)).toEqual([]);
    expect(data.reports[0].rookie).toEqual([]);
    expect((await publicAwards("test-cup"))![0]).toMatchObject({
      stale: true,
      candidates: [],
      rookie: [],
    });
    await expect(
      awardCommand(admin, "test-cup", {
        action: "configure",
        policy: "relative-game-mean-v1",
        confirmed: true,
        expectedVersion: 1,
        weeks: awardWeeks,
        tiers: [{ userId: seeded.home.captainId, tier: 4 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("does not disclose an unpublished captain through Tier 0 awards", async () => {
    const { seeded } = await configure();
    await db()
      .update(captains)
      .set({ published: false })
      .where(eq(captains.userId, seeded.home.captainId));
    const data = await awardWorkspace(admin, "test-cup");
    expect(
      data.tiers.find((t) => t.userId === seeded.home.captainId)?.tier,
    ).toBe(0);
    await expect(publish(data.reports[0].fingerprint)).rejects.toMatchObject({
      status: 409,
    });
    expect(await publicAwards("test-cup")).toEqual([]);
  });
  it("uses only included published approved games, keeps repeated publication idempotent, and preserves release history", async () => {
    const { data, seeded } = await configure();
    expect(data.reports[0].issues).toEqual([]);
    expect(data.reports[0].candidates.every((c) => c.appearances === 6)).toBe(
      true,
    );
    expect(await publicAwards("test-cup")).toEqual([]);
    await publish(data.reports[0].fingerprint);
    await publish(data.reports[0].fingerprint);
    expect(await db().select().from(weeklyAwardReleases)).toHaveLength(1);
    expect((await publicAwards("test-cup"))![0].stale).toBe(false);
    // A submitted correction does not replace the authoritative published revision.
    await db()
      .update(matchResults)
      .set({ state: "submitted", currentRevision: 2 })
      .where(eq(matchResults.fixtureId, seeded.fixtureId));
    expect((await publicAwards("test-cup"))![0].stale).toBe(false);
    await db()
      .update(fixtures)
      .set({ scheduledAt: new Date("2026-10-09T12:00:00Z") })
      .where(eq(fixtures.id, seeded.fixtureId));
    const stale = (await publicAwards("test-cup"))![0];
    expect(stale.stale).toBe(true);
    expect(stale.candidates).toEqual([]);
    expect(stale.mvp).toEqual([]);
    await expect(publish(data.reports[0].fingerprint)).rejects.toMatchObject({
      status: 409,
    });
    const refreshed = await awardWorkspace(admin, "test-cup");
    await publish(refreshed.reports[0].fingerprint);
    expect(await db().select().from(weeklyAwardReleases)).toHaveLength(2);
    const release = (await awardWorkspace(admin, "test-cup")).releases[0];
    await awardCommand(admin, "test-cup", {
      action: "unpublish",
      confirmed: true,
      expectedVersion: 1,
      week: 1,
      releaseId: release.id,
    });
    expect(await publicAwards("test-cup")).toEqual([]);
  });
  it("enforces role scope, concurrent configuration versions and publication privacy", async () => {
    await configure();
    await expect(awardWorkspace(referee, "test-cup")).rejects.toMatchObject({
      status: 403,
    });
    await db().insert(editionState).values({ slug: "other-cup" });
    await db().insert(staffRoles).values({
      userId: referee.osuId,
      role: "admin",
      editionSlug: "other-cup",
      grantedBy: admin.osuId,
    });
    await expect(awardWorkspace(referee, "test-cup")).rejects.toMatchObject({
      status: 403,
    });
    const command = {
      action: "configure",
      policy: "relative-game-mean-v1",
      confirmed: true,
      expectedVersion: 1,
      weeks: awardWeeks,
    };
    const attempts = await Promise.allSettled([
      awardCommand(admin, "test-cup", command),
      awardCommand(admin, "test-cup", command),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const current = await awardWorkspace(admin, "test-cup");
    await db()
      .update(registrations)
      .set({ status: "pending" })
      .where(eq(registrations.userId, current.reports[0].mvp[0]));
    const privateData = await awardWorkspace(admin, "test-cup");
    await expect(
      awardCommand(admin, "test-cup", {
        action: "publish",
        confirmed: true,
        expectedVersion: 2,
        week: 1,
        fingerprint: privateData.reports[0].fingerprint,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await db().select().from(editionEvents)).filter(
        (e) => e.kind === "awards_publish",
      ),
    ).toHaveLength(0);
  });
  it("ignores legacy manual Tiers and invalidates releases after source retraction", async () => {
    const { data, seeded } = await configure();
    await publish(data.reports[0].fingerprint);
    await db()
      .update(awardSettings)
      .set({ tiers: [{ userId: seeded.home.captainId, tier: 4 }] })
      .where(eq(awardSettings.editionSlug, "test-cup"));
    expect(
      (await awardWorkspace(admin, "test-cup")).tiers.every(
        (t) => t.tier === 0,
      ),
    ).toBe(true);
    expect((await publicAwards("test-cup"))![0].stale).toBe(false);
    await db()
      .update(matchResults)
      .set({ publishedRevision: null, publishedAt: null })
      .where(eq(matchResults.fixtureId, seeded.fixtureId));
    expect(
      (await awardWorkspace(admin, "test-cup")).reports[0].candidates,
    ).toEqual([]);
    expect((await publicAwards("test-cup"))![0].candidates).toEqual([]);
  });
});
