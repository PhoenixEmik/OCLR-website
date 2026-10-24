import { describe, it, expect } from "vitest";
import { calculateRating, type RatingGame } from "../../src/lib/yumu-rating";
export const ratingGame = (id = 1): RatingGame => ({
  gameId: id,
  fixtureId: "f",
  at: "2026-10-03T00:00:00Z",
  revision: 1,
  fingerprint: "source",
  teamIds: ["home", "away"],
  winnerTeamId: "home",
  scores: [
    { userId: 1, teamId: "home", total: 200 },
    { userId: 2, teamId: "home", total: 100 },
    { userId: 3, teamId: "away", total: 100 },
  ],
});
describe("approved-game YumuRating", () => {
  it("matches a hand-calculated RRA/ERA/DRA/MRA/RWS example", () => {
    const r = calculateRating([ratingGame()]);
    const p = r.players[0];
    const s = 2 / (1 + Math.exp(-0.25)) - 1;
    const era = (1.5 - 0.75 * s) / (1 - 0.75 * s);
    expect(r.issues).toEqual([]);
    expect(p).toMatchObject({
      userId: 1,
      appearances: 1,
      totalMu: 1.5,
      averageMu: 1.5,
      mq: 1.5,
      dra: 1.5,
      rank: 1,
      eraIndex: 0,
    });
    expect(p.era).toBeCloseTo(era, 9);
    expect(p.mra).toBeCloseTo(0.7 * era + 0.45, 9);
    expect(p.rws).toBeCloseTo(2 / 3, 9);
  });
  it("retains zero-score appearances and legitimate repeated maps; deduplicates by game ID", () => {
    const a = ratingGame(),
      b = ratingGame(2);
    b.scores[0].total = 0;
    const r = calculateRating([a, b, structuredClone(a)]);
    expect(r.gameCount).toBe(2);
    expect(r.scoreCount).toBe(6);
    expect(r.players.find((p) => p.userId === 1)?.appearances).toBe(2);
  });
  it("keeps identical metrics tied and order independent", () => {
    const a = ratingGame();
    a.scores.forEach((s) => (s.total = 100));
    a.winnerTeamId = null;
    const r = calculateRating([a]);
    expect(
      r.players.map((p) => [p.rank, p.eraIndex, p.draIndex, p.rwsIndex]),
    ).toEqual([
      [1, 0.5, 0.5, 0.5],
      [1, 0.5, 0.5, 0.5],
      [1, 0.5, 0.5, 0.5],
    ]);
    expect(
      calculateRating([
        {
          ...a,
          scores: [...a.scores].reverse(),
          teamIds: [...a.teamIds].reverse(),
        },
      ]),
    ).toEqual(r);
  });
  it("withholds invalid reports and conflicting duplicates instead of partial rankings", () => {
    for (const edit of [
      (g: RatingGame) => (g.scores[0].total = -1),
      (g: RatingGame) => g.scores.forEach((s) => (s.total = 0)),
      (g: RatingGame) => (g.scores[0].teamId = "unknown"),
      (g: RatingGame) => g.scores.push(g.scores[0]),
      (g: RatingGame) => (g.scores[0].total = Infinity),
    ]) {
      const bad = ratingGame(2);
      edit(bad);
      const r = calculateRating([ratingGame(), bad]);
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.players).toEqual([]);
    }
    const g = ratingGame();
    g.scores[0].total = 123;
    expect(calculateRating([ratingGame(), g]).issues).toContain(
      "Game 1: conflicting duplicate",
    );
  });
  it("handles empty, one-player and two-player populations without nonfinite numbers", () => {
    expect(calculateRating([]).players).toEqual([]);
    for (const n of [1, 2]) {
      const g = ratingGame();
      g.scores = g.scores.slice(0, n);
      const r = calculateRating([g]);
      expect(r.issues).toEqual([]);
      expect(JSON.stringify(r)).not.toContain("NaN");
      expect(r.players[0].eraIndex).toBe(n === 1 ? null : 0);
    }
  });
  it("does not use optional star metadata", () => {
    const a = { ...ratingGame(), stars: 1 },
      b = { ...ratingGame(), stars: 12 };
    expect(calculateRating([a])).toEqual(calculateRating([b]));
  });
  it("recomputes the player union rather than averaging fixture MRAs", () => {
    const a = ratingGame(),
      b = ratingGame(2);
    b.fixtureId = "g";
    b.scores = b.scores.filter((s) => s.userId !== 3);
    b.scores[0].total = 100;
    const combined = calculateRating([a, b]).players.find(
      (p) => p.userId === 1,
    )!;
    const mean =
      (calculateRating([a]).players[0].mra +
        calculateRating([b]).players.find((p) => p.userId === 1)!.mra) /
      2;
    expect(combined.mra).not.toBeCloseTo(mean, 5);
    expect(calculateRating([b, a])).toEqual(calculateRating([a, b]));
  });
});
