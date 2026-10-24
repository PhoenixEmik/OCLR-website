import { describe, it, expect } from "vitest";
import { weeklyStandings } from "../../src/lib/award-model";
import {
  calculateRating,
  YUMU_POLICY,
  type RatingGame,
} from "../../src/lib/yumu-rating";
const weeks = [
  {
    number: 1,
    startsAt: "2026-10-01T00:00:00Z",
    endsAt: "2026-10-08T00:00:00Z",
  },
  {
    number: 2,
    startsAt: "2026-10-08T00:00:00Z",
    endsAt: "2026-10-15T00:00:00Z",
  },
];
const games = (week: number, count: number): RatingGame[] =>
  Array.from({ length: count }, (_, i) => ({
    gameId: week * 100 + i,
    fixtureId: `f${week}`,
    at: week === 1 ? "2026-10-03T00:00:00Z" : "2026-10-09T00:00:00Z",
    revision: 1,
    fingerprint: "source",
    teamIds: ["home", "away"],
    winnerTeamId: "home",
    scores: [1, 2, 3, 4].map((userId) => ({
      userId,
      teamId: userId <= 2 ? "home" : "away",
      total: week === 2 && userId === 1 ? 300 : 100,
    })),
  }));
describe("weekly YumuRating policy", () => {
  it("recomputes all weekly games and preserves eligibility and absolute adjacent-week MIP", () => {
    const input = [...games(1, 5), ...games(2, 6)],
      tiers = [
        { userId: 1, tier: 0 },
        { userId: 2, tier: 4 },
        { userId: 3, tier: 3 },
      ];
    const [first, second] = weeklyStandings(weeks, tiers, input, YUMU_POLICY);
    expect(first.mvp).toEqual([]);
    expect(first.mip).toEqual([]);
    expect(second.mvp).toEqual([1]);
    expect(second.mip).toEqual([1]);
    expect(second.rookie).toEqual([2]);
    const row = second.candidates.find((p) => p.userId === 1)!;
    expect(row.performance).toBe(
      Math.round(calculateRating(games(2, 6)).players[0].mra * 1e9),
    );
    expect(row.previousPerformance).toBe(1e9);
    expect(row.improvement).toBeGreaterThan(0);
    expect(row.rating?.mra).toBe(row.performance / 1e9);
  });
  it("rejects insufficient appearances, missing prior week and nonpositive growth", () => {
    const [a, b] = weeklyStandings(
      weeks,
      [],
      [...games(1, 4), ...games(2, 6)],
      YUMU_POLICY,
    );
    expect(a.mvp).toEqual([]);
    expect(b.mip).toEqual([]);
    expect(weeklyStandings(weeks, [], games(2, 6), YUMU_POLICY)[1].mip).toEqual(
      [],
    );
    const same = [
      ...games(1, 6),
      ...games(2, 6).map((g) => ({
        ...g,
        scores: g.scores.map((s) => ({ ...s, total: 100 })),
      })),
    ];
    expect(weeklyStandings(weeks, [], same, YUMU_POLICY)[1].mip).toEqual([]);
  });
  it("keeps weeks start-inclusive and end-exclusive regardless of round labels", () => {
    const g = games(1, 1)[0];
    g.at = weeks[1].startsAt;
    const [a, b] = weeklyStandings(weeks, [], [g], YUMU_POLICY);
    expect(a.candidates).toEqual([]);
    expect(b.candidates).toHaveLength(4);
  });
});
