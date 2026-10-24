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
  users,
  fixtures,
  weeklyAwardReleases,
  awardSettings,
} from "../../src/db/schema";
import { publicRoundRatings } from "../../src/lib/ratings";
import {
  awardCommand,
  publicAwards,
  awardWorkspace,
} from "../../src/lib/awards";
import { seedEditions } from "../fixtures/editions";
import { seedAwardReview, awardWeeks } from "../fixtures/awards";
import { assertTestDatabase } from "../database";
const url = process.env.TEST_DATABASE_URL,
  admin = { osuId: 193001, username: "Synthetic Series Admin" };
describe.skipIf(!url)("round ratings and versioned awards", () => {
  beforeAll(() => {
    assertTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("ADMIN_OSU_IDS", String(admin.osuId));
  });
  beforeEach(async () => {
    await db().execute(sql`TRUNCATE edition_state, users CASCADE`);
    await seedEditions();
    await db()
      .insert(users)
      .values([admin, { osuId: 193002, username: "Synthetic Referee" }]);
  });
  afterAll(async () => {
    await closeDb();
    vi.unstubAllEnvs();
  });
  it("keeps legacy snapshots intact, switches policies explicitly and requires republication", async () => {
    await seedAwardReview(admin.osuId, 193002, 193100);
    expect((await awardWorkspace(admin, "test-cup")).policy).toBe(
      "yumu-mra-v1",
    );
    let d = await awardCommand(admin, "test-cup", {
      action: "configure",
      confirmed: true,
      expectedVersion: 0,
      weeks: awardWeeks,
      policy: "relative-game-mean-v1",
    });
    await awardCommand(admin, "test-cup", {
      action: "publish",
      confirmed: true,
      expectedVersion: 1,
      week: 1,
      fingerprint: d.reports[0].fingerprint,
    });
    const [legacy] = await db().select().from(weeklyAwardReleases);
    d = await awardCommand(admin, "test-cup", {
      action: "configure",
      confirmed: true,
      expectedVersion: 1,
      weeks: awardWeeks,
      policy: "yumu-mra-v1",
    });
    d = await awardCommand(admin, "test-cup", {
      action: "configure",
      confirmed: true,
      expectedVersion: 2,
      weeks: awardWeeks,
    });
    expect(d.policy).toBe("yumu-mra-v1");
    expect((await publicAwards("test-cup"))?.[0].stale).toBe(true);
    expect(d.reports[0].policy).toBe("yumu-mra-v1");
    expect(d.reports[0].candidates[0].rating).toBeDefined();
    await awardCommand(admin, "test-cup", {
      action: "publish",
      confirmed: true,
      expectedVersion: 3,
      week: 1,
      fingerprint: d.reports[0].fingerprint,
    });
    expect((await publicAwards("test-cup"))?.[0]).toMatchObject({
      policy: "yumu-mra-v1",
      stale: false,
    });
    const history = await db().select().from(weeklyAwardReleases);
    expect(history).toHaveLength(2);
    expect(history.find((r) => r.id === legacy.id)?.report).toEqual(
      legacy.report,
    );
    expect((await db().select().from(awardSettings))[0].policy).toBe(
      "yumu-mra-v1",
    );
  });
  it("marks incomplete rounds provisional, excludes other editions, follows fixture withdrawal", async () => {
    const s = await seedAwardReview(admin.osuId, 193002, 193100);
    let rounds = await publicRoundRatings("test-cup");
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      complete: true,
      publishedFixtures: 1,
      ratedFixtures: 1,
    });
    expect(rounds[0].report.gameCount).toBe(6);
    const [original] = await db()
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, s.fixtureId));
    await db()
      .insert(fixtures)
      .values({
        ...original,
        id: crypto.randomUUID(),
        label: "Synthetic pending fixture",
        position: 2,
      });
    rounds = await publicRoundRatings("test-cup");
    expect(rounds[0]).toMatchObject({
      complete: false,
      publishedFixtures: 2,
      ratedFixtures: 1,
    });
    const workspace = await awardCommand(admin, "test-cup", {
      action: "configure",
      confirmed: true,
      expectedVersion: 0,
      weeks: awardWeeks,
      policy: "yumu-mra-v1",
    });
    expect(workspace.reports[0].issues).toContain(
      "This award week still has fixtures awaiting approved published game data.",
    );
    await expect(
      awardCommand(admin, "test-cup", {
        action: "publish",
        confirmed: true,
        expectedVersion: 1,
        week: 1,
        fingerprint: workspace.reports[0].fingerprint,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await publicRoundRatings("private-test-cup")).toEqual([]);
    await db()
      .update(fixtures)
      .set({ publishedAt: null })
      .where(eq(fixtures.id, s.fixtureId));
    rounds = await publicRoundRatings("test-cup");
    expect(rounds[0].report.players).toEqual([]);
    expect(rounds[0].complete).toBe(false);
  });
});
