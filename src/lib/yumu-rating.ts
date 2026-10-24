/**
 * YumuRating formula adapted from yumu-bot (Apache-2.0), commit
 * 8b52582efaa621eec26e6ce9151924435c96a3d4. OCLR changes: approved games only,
 * zero-score appearances retained, tied maps have zero RWS, deterministic ties,
 * finite arithmetic and no SR weighting. See docs/yumu-rating.md and LICENSES.
 */
export const YUMU_POLICY = "yumu-mra-v1";
export const ratingRound = (value: number) => Math.round(value * 1e9) / 1e9;
export type RatingScore = { userId: number; total: number; teamId: string };
export type RatingGame = {
  gameId: number;
  fixtureId: string;
  revision: number;
  fingerprint: string;
  approvalFingerprint?: string;
  at: string | null;
  teamIds: string[];
  winnerTeamId: string | null;
  scores: RatingScore[];
  problem?: string;
};
export type PlayerRating = {
  userId: number;
  appearances: number;
  totalMu: number;
  averageMu: number;
  mq: number;
  era: number;
  dra: number;
  mra: number;
  rws: number;
  rank: number;
  eraIndex: number | null;
  draIndex: number | null;
  rwsIndex: number | null;
};
export type RatingReport = {
  policy: typeof YUMU_POLICY;
  players: PlayerRating[];
  gameCount: number;
  scoreCount: number;
  playerCount: number;
  issues: string[];
};
/** Midrank percentiles: identical metrics never get different classification inputs. */
function indices(
  rows: PlayerRating[],
  compare: (a: PlayerRating, b: PlayerRating) => number,
  key: "eraIndex" | "draIndex" | "rwsIndex",
) {
  if (rows.length < 2) return;
  const sorted = [...rows].sort(compare);
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (
      end + 1 < sorted.length &&
      compare(sorted[start], sorted[end + 1]) === 0
    )
      end++;
    const index = (start + end) / 2 / (sorted.length - 1);
    for (let i = start; i <= end; i++) sorted[i][key] = index;
    start = end + 1;
  }
}
export function calculateRating(input: readonly RatingGame[]): RatingReport {
  const issues: string[] = [];
  const games = new Map<number, RatingGame>();
  for (const raw of input) {
    const game = {
      ...raw,
      teamIds: [...raw.teamIds].sort(),
      scores: [...raw.scores].sort((a, b) => a.userId - b.userId),
    };
    const previous = games.get(game.gameId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(game))
      issues.push(`Game ${game.gameId}: conflicting duplicate`);
    games.set(game.gameId, game);
  }
  const totals = new Map<number, { count: number; mu: number; rws: number }>();
  let gameCount = 0,
    scoreCount = 0;
  for (const game of [...games.values()].sort((a, b) => a.gameId - b.gameId)) {
    const sum = game.scores.reduce((n, s) => n + s.total, 0);
    if (
      game.problem ||
      !Number.isSafeInteger(game.gameId) ||
      game.gameId <= 0 ||
      !game.scores.length ||
      game.teamIds.length !== 2 ||
      new Set(game.teamIds).size !== 2 ||
      (game.winnerTeamId !== null &&
        !game.teamIds.includes(game.winnerTeamId)) ||
      new Set(game.scores.map((s) => s.userId)).size !== game.scores.length ||
      game.scores.some(
        (s) =>
          !Number.isSafeInteger(s.userId) ||
          s.userId <= 0 ||
          !Number.isSafeInteger(s.total) ||
          s.total < 0 ||
          !game.teamIds.includes(s.teamId),
      ) ||
      !Number.isSafeInteger(sum) ||
      sum <= 0
    ) {
      issues.push(
        `Game ${game.gameId}: ${game.problem || "unverified or incomparable scores"}`,
      );
      continue;
    }
    const winningTotal = game.scores
      .filter((s) => s.teamId === game.winnerTeamId)
      .reduce((n, s) => n + s.total, 0);
    if (game.winnerTeamId && winningTotal <= 0) {
      issues.push(`Game ${game.gameId}: invalid winning team score`);
      continue;
    }
    gameCount++;
    scoreCount += game.scores.length;
    for (const score of game.scores) {
      const value = totals.get(score.userId) ?? { count: 0, mu: 0, rws: 0 };
      value.count++;
      value.mu += (score.total * game.scores.length) / sum;
      value.rws +=
        game.winnerTeamId === score.teamId ? score.total / winningTotal : 0;
      totals.set(score.userId, value);
    }
  }
  const rows = [...totals.entries()].sort(([a], [b]) => a - b);
  const meanAMG =
    rows.reduce((n, [, v]) => n + v.mu / v.count, 0) / rows.length;
  const minMQ = rows.length
    ? Math.min(...rows.map(([, v]) => v.mu / v.count / meanAMG))
    : 0;
  // Complement of the upstream scaling factor, avoiding loss of precision at large N.
  const complement =
    rows.length <= 2 ? 1 : 2 / (1 + Math.exp(0.25 * rows.length - 0.5));
  const denominator = 1 - minMQ + minMQ * complement;
  const players: PlayerRating[] = rows.map(([userId, v]) => {
    const mq = v.mu / v.count / meanAMG;
    const era =
      denominator > 0 ? (mq - minMQ + minMQ * complement) / denominator : 1;
    const dra = (v.mu / scoreCount) * rows.length;
    return {
      userId,
      appearances: v.count,
      totalMu: ratingRound(v.mu),
      averageMu: ratingRound(v.mu / v.count),
      mq: ratingRound(mq),
      era: ratingRound(era),
      dra: ratingRound(dra),
      mra: ratingRound(0.7 * era + 0.3 * dra),
      rws: ratingRound(v.rws / v.count),
      rank: 0,
      eraIndex: null,
      draIndex: null,
      rwsIndex: null,
    };
  });
  indices(players, (a, b) => b.era - a.era, "eraIndex");
  indices(players, (a, b) => b.dra - a.dra, "draIndex");
  indices(players, (a, b) => b.rws - a.rws || b.dra - a.dra, "rwsIndex");
  players.sort((a, b) => b.mra - a.mra || a.userId - b.userId);
  players.forEach((p, i) => {
    p.rank = i && p.mra === players[i - 1].mra ? players[i - 1].rank : i + 1;
  });
  return {
    policy: YUMU_POLICY,
    players: issues.length ? [] : players,
    gameCount,
    scoreCount,
    playerCount: rows.length,
    issues: [...new Set(issues)].sort(),
  };
}
