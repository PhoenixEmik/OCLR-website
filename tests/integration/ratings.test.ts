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
import { users, fixtures, matchResults, teams } from "../../src/db/schema";
import { publicMatchRating, matchRatingWorkspace } from "../../src/lib/ratings";
import { seedEditions } from "../fixtures/editions";
import { seedAwardReview } from "../fixtures/awards";
import { assertTestDatabase } from "../database";
const url = process.env.TEST_DATABASE_URL;
const admin = { osuId: 192001, username: "Synthetic Rating Admin" };
describe.skipIf(!url)("approved fixture ratings", () => {
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
      .values([admin, { osuId: 192002, username: "Synthetic Referee" }]);
  });
  afterAll(async () => {
    await closeDb();
    vi.unstubAllEnvs();
  });
  it("uses published pointers and withholds unapproved, private or withdrawn sources", async () => {
    const s = await seedAwardReview(admin.osuId, 192002, 192100);
    const r = await publicMatchRating("test-cup", s.fixtureId);
    expect(r?.gameCount).toBe(6);
    expect(r?.players).toHaveLength(4);
    expect(r?.issues).toEqual([]);
    expect(
      await matchRatingWorkspace(admin, "test-cup", s.fixtureId),
    ).toMatchObject({ fingerprint: r!.fingerprint });
    await db()
      .update(matchResults)
      .set({ currentRevision: 2 })
      .where(eq(matchResults.fixtureId, s.fixtureId));
    expect(
      (await publicMatchRating("test-cup", s.fixtureId))?.fingerprint,
    ).toBe(r!.fingerprint);
    expect(await publicMatchRating("private-test-cup", s.fixtureId)).toBeNull();
    await db()
      .update(matchResults)
      .set({ publishedRevision: null, publishedAt: null })
      .where(eq(matchResults.fixtureId, s.fixtureId));
    expect(await publicMatchRating("test-cup", s.fixtureId)).toBeNull();
  });
  it("keeps role and team release boundaries even for direct service callers", async () => {
    const s = await seedAwardReview(admin.osuId, 192002, 192100);
    await expect(
      matchRatingWorkspace(
        { osuId: 192002, username: "Referee" },
        "test-cup",
        s.fixtureId,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await db()
      .update(teams)
      .set({ rosterPublished: false })
      .where(eq(teams.id, s.home.teamId));
    expect(await publicMatchRating("test-cup", s.fixtureId)).toBeNull();
    await db()
      .update(teams)
      .set({ rosterPublished: true })
      .where(eq(teams.id, s.home.teamId));
    await db()
      .update(fixtures)
      .set({ status: "cancelled" })
      .where(eq(fixtures.id, s.fixtureId));
    expect(await publicMatchRating("test-cup", s.fixtureId)).toBeNull();
    expect(await publicMatchRating("test-cup", "unknown-fixture")).toBeNull();
    // Accepted registration metadata never enters the public rating projection.
    const serialized = JSON.stringify(
      await matchRatingWorkspace(admin, "test-cup", s.fixtureId),
    );
    expect(serialized).not.toContain("SYNTHETIC_PRIVATE_CONTACT");
    expect(serialized).not.toContain("SYNTHETIC_INTERNAL_REASON");
  });
});
