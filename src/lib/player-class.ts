/** Adapted/modified from yumu-bot PlayerClass.kt (Apache-2.0), pinned
 * 8b52582efaa621eec26e6ce9151924435c96a3d4. OCLR adds strict input validation,
 * tie-safe percentile inputs and no class for populations smaller than three.
 * See docs/yumu-rating.md and LICENSES/yumu-bot-Apache-2.0.txt.
 */
import type { PlayerRating } from "./yumu-rating";
export const PLAYER_CLASS_POLICY = "yumu-player-class-v2-oclr-v1";
export const classRules = {
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
} as const;
export type BaseClass = keyof typeof classRules;
export type PlayerClassCode = (typeof classRules)[BaseClass]["codes"][number];
export type PlayerClass = {
  category: BaseClass;
  code: PlayerClassCode;
  policy: typeof PLAYER_CLASS_POLICY;
};
const validIndex = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
export function basePlayerClass(
  eraIndex: number,
  draIndex: number,
): BaseClass | null {
  if (!validIndex(eraIndex) || !validIndex(draIndex)) return null;
  if (eraIndex < 1 / 6)
    return draIndex < 1 / 6
      ? "BC"
      : draIndex < 2 / 6
        ? "CA"
        : draIndex < 4 / 6
          ? "MF"
          : "SP";
  if (eraIndex < 2 / 6)
    return draIndex < 2 / 6 ? "CA" : draIndex < 4 / 6 ? "MF" : "SP";
  if (eraIndex < 4 / 6)
    return draIndex < 2 / 6 ? "WF" : draIndex < 4 / 6 ? "GE" : "GU";
  if (eraIndex < 5 / 6)
    return draIndex < 2 / 6 ? "SU" : draIndex < 4 / 6 ? "SG" : "NO";
  return draIndex < 2 / 6
    ? "SU"
    : draIndex < 4 / 6
      ? "SG"
      : draIndex < 5 / 6
        ? "NO"
        : "FU";
}
export function playerClassV2(
  eraIndex: number,
  draIndex: number,
  rwsIndex: number,
): PlayerClass | null {
  const category = basePlayerClass(eraIndex, draIndex);
  if (!category || !validIndex(rwsIndex)) return null;
  const rule = classRules[category];
  return {
    category,
    code: rule.codes[
      rwsIndex < rule.cuts[0] ? 0 : rwsIndex < rule.cuts[1] ? 1 : 2
    ],
    policy: PLAYER_CLASS_POLICY,
  };
}
export function classifyPlayer(
  p: PlayerRating,
  playerCount: number,
): PlayerClass | null {
  if (
    !Number.isSafeInteger(playerCount) ||
    playerCount < 3 ||
    !Number.isSafeInteger(p.appearances) ||
    p.appearances < 1 ||
    p.eraIndex === null ||
    p.draIndex === null ||
    p.rwsIndex === null
  )
    return null;
  return playerClassV2(p.eraIndex, p.draIndex, p.rwsIndex);
}
