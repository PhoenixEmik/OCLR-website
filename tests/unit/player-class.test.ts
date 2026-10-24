import { describe, it, expect } from "vitest";
import {
  basePlayerClass,
  playerClassV2,
  classifyPlayer,
  type BaseClass,
} from "../../src/lib/player-class";
import { calculateRating, type RatingGame } from "../../src/lib/yumu-rating";
const cases: [number, number, BaseClass][] = [
  [0, 0, "BC"],
  [0.2, 0.2, "CA"],
  [0.2, 0.5, "MF"],
  [0.2, 0.8, "SP"],
  [0.4, 0.1, "WF"],
  [0.4, 0.5, "GE"],
  [0.4, 0.8, "GU"],
  [0.7, 0.1, "SU"],
  [0.7, 0.5, "SG"],
  [0.7, 0.8, "NO"],
  [0.9, 0.9, "FU"],
];
describe("PlayerClass V1/V2", () => {
  it.each(cases)(
    "classifies ERA %s DRA %s as %s and covers all three RWS refinements",
    (e, d, category) => {
      expect(basePlayerClass(e, d)).toBe(category);
      const expected = {
        BC: { cuts: [1 / 9, 3 / 9], codes: ["SMA", "CMA", "IMA"] },
        CA: { cuts: [2 / 9, 4 / 9], codes: ["EGE", "AGE", "SGE"] },
        MF: { cuts: [2 / 9, 5 / 9], codes: ["BMF", "RMF", "SMF"] },
        SP: { cuts: [3 / 9, 6 / 9], codes: ["EAS", "NAS", "FAS"] },
        WF: { cuts: [2 / 9, 5 / 9], codes: ["GCW", "WCW", "BCW"] },
        GE: { cuts: [3 / 9, 6 / 9], codes: ["KPS", "CMN", "PSB"] },
        GU: { cuts: [4 / 9, 7 / 9], codes: ["MAC", "MIC", "FIG"] },
        SU: { cuts: [3 / 9, 6 / 9], codes: ["SAM", "HAS", "SIN"] },
        SG: { cuts: [4 / 9, 7 / 9], codes: ["ANI", "MNI", "LCS"] },
        NO: { cuts: [5 / 9, 7 / 9], codes: ["LKD", "QAP", "BGN"] },
        FU: { cuts: [6 / 9, 8 / 9], codes: ["LSS", "LSP", "BDT"] },
      };
      const rule = expected[category];
      expect(playerClassV2(e, d, 0)?.code).toBe(rule.codes[0]);
      expect(playerClassV2(e, d, rule.cuts[0])?.code).toBe(rule.codes[1]);
      expect(playerClassV2(e, d, rule.cuts[1])?.code).toBe(rule.codes[2]);
      for (const [i, cut] of rule.cuts.entries()) {
        expect(playerClassV2(e, d, cut - Number.EPSILON)?.code).toBe(
          rule.codes[i],
        );
        expect(playerClassV2(e, d, cut + Number.EPSILON)?.code).toBe(
          rule.codes[i + 1],
        );
      }
      expect(playerClassV2(e, d, 1)?.code).toBe(rule.codes[2]);
    },
  );
  it("uses strict V1 boundaries in both dimensions", () => {
    const boundaries = [1 / 6, 2 / 6, 4 / 6, 5 / 6];
    // Values at a threshold select the same branch as values just above it.
    for (const cut of boundaries) {
      for (const other of [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1]) {
        expect(basePlayerClass(cut, other)).toBe(
          basePlayerClass(cut + Number.EPSILON, other),
        );
        expect(basePlayerClass(other, cut)).toBe(
          basePlayerClass(other, cut + Number.EPSILON),
        );
      }
    }
    expect(basePlayerClass(1 / 6 - Number.EPSILON, 0)).toBe("BC");
    expect(basePlayerClass(1 / 6, 0)).toBe("CA");
    expect(basePlayerClass(2 / 6 - Number.EPSILON, 0.5)).toBe("MF");
    expect(basePlayerClass(2 / 6, 0.5)).toBe("GE");
    expect(basePlayerClass(4 / 6 - Number.EPSILON, 0.5)).toBe("GE");
    expect(basePlayerClass(4 / 6, 0.5)).toBe("SG");
    expect(basePlayerClass(5 / 6 - Number.EPSILON, 1)).toBe("NO");
    expect(basePlayerClass(5 / 6, 1)).toBe("FU");
  });
  it("rejects invalid indices without a fabricated default class", () => {
    for (const bad of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
      expect(basePlayerClass(bad, 0.5)).toBeNull();
      expect(basePlayerClass(0.5, bad)).toBeNull();
      expect(playerClassV2(0.5, 0.5, bad)).toBeNull();
    }
  });
  it("classifies tied performances equally regardless of input order, and withholds tiny populations", () => {
    const game: RatingGame = {
      gameId: 1,
      fixtureId: "f",
      at: null,
      revision: 1,
      fingerprint: "x",
      teamIds: ["h", "a"],
      winnerTeamId: null,
      scores: [1, 2, 3].map((userId) => ({
        userId,
        teamId: userId === 1 ? "h" : "a",
        total: 100,
      })),
    };
    const a = calculateRating([game]);
    const b = calculateRating([
      { ...game, scores: [...game.scores].reverse() },
    ]);
    expect(a.players.map((p) => classifyPlayer(p, a.playerCount))).toEqual(
      b.players.map((p) => classifyPlayer(p, b.playerCount)),
    );
    expect(new Set(a.players.map((p) => classifyPlayer(p, 3)?.code))).toEqual(
      new Set(["CMN"]),
    );
    expect(classifyPlayer(a.players[0], 1)).toBeNull();
    expect(classifyPlayer(a.players[0], 2)).toBeNull();
  });
});
