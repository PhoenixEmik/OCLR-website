import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db";
import { users } from "../../src/db/schema";
import { publicMatchRating, publicRoundRatings } from "../../src/lib/ratings";
import { seedEditions } from "../fixtures/editions";
import { seedAwardReview } from "../fixtures/awards";
import { assertTestDatabase } from "../database";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("classification evidence follows rating scope", () => {
  beforeAll(() => {
    assertTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url!);
  });
  beforeEach(async () => {
    await db().execute(sql`TRUNCATE edition_state, users CASCADE`);
    await seedEditions();
    await db()
      .insert(users)
      .values([
        { osuId: 194001, username: "Synthetic Admin" },
        { osuId: 194002, username: "Synthetic Referee" },
      ]);
  });
  afterAll(async () => {
    await closeDb();
    vi.unstubAllEnvs();
  });
  it("derives class from its own published comparison population with traceable policy", async () => {
    const s = await seedAwardReview(194001, 194002, 194100);
    const match = await publicMatchRating("test-cup", s.fixtureId),
      rounds = await publicRoundRatings("test-cup");
    expect(match?.classificationPolicy).toBe("yumu-player-class-v2-oclr-v1");
    expect(match?.players).toHaveLength(4);
    expect(
      match?.players.every(
        (p) => p.classification?.policy === match.classificationPolicy,
      ),
    ).toBe(true);
    expect(rounds[0].report.players).toEqual(match?.players);
    expect(await publicMatchRating("private-test-cup", s.fixtureId)).toBeNull();
  });
});
