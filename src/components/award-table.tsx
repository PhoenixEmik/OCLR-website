"use client";
import { PlayerClassBadge } from "./player-class-badge";
import { useAppTranslations } from "@/i18n/shared";
import { awardTierLabel } from "@/lib/award-tiers";
import { awardValue, type AwardCandidate } from "@/lib/award-model";
export function AwardTable({
  candidates,
  mvp,
  mip,
  rookie,
  explain = false,
  policy = "relative-game-mean-v1",
}: {
  candidates: (AwardCandidate & { username: string })[];
  mvp: number[];
  mip: number[];
  rookie: number[];
  explain?: boolean;
  policy?: string;
}) {
  const tr = useAppTranslations();
  return (
    <div className="table-scroll">
      <table className="award-table">
        <thead>
          <tr>
            <th>{tr("Player")}</th>
            <th>{tr("Tier")}</th>
            <th>{tr("Appearances")}</th>
            <th>{tr("Weekly performance")}</th>
            {policy === "yumu-mra-v1" && <th>{tr("Player evaluation")}</th>}
            <th>{tr("Previous week")}</th>
            <th>{tr("Improvement")}</th>
            <th>{tr("Awards")}</th>
            {explain && <th>{tr("Eligibility")}</th>}
          </tr>
        </thead>
        <tbody>
          {candidates.map((row) => (
            <tr key={row.userId}>
              <th scope="row">
                <a
                  href={`https://osu.ppy.sh/users/${row.userId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {row.username}
                </a>
              </th>
              <td>{awardTierLabel(row.tier)}</td>
              <td>{row.appearances}</td>
              <td>{awardValue(row.performance, policy)}</td>
              {policy === "yumu-mra-v1" && (
                <td>
                  <PlayerClassBadge
                    classification={row.ratingClass ?? null}
                    indices={row.rating}
                  />
                </td>
              )}
              <td>
                {row.previousPerformance === null
                  ? "—"
                  : `${awardValue(row.previousPerformance, policy)} (${row.previousAppearances})`}
              </td>
              <td>
                {row.improvement === null
                  ? "—"
                  : policy === "yumu-mra-v1"
                    ? `${row.improvement > 0 ? "+" : ""}${awardValue(row.improvement, policy)}`
                    : tr("{value0} percentage points", {
                        value0: `${row.improvement > 0 ? "+" : ""}${(row.improvement / 10_000_000).toFixed(7)}`,
                      })}
              </td>
              <td>
                {[
                  ["MVP", mvp],
                  ["MIP", mip],
                  [tr("Best Rookie"), rookie],
                ]
                  .flatMap(([name, ids]) =>
                    (ids as number[]).includes(row.userId)
                      ? [
                          `${name}${(ids as number[]).length > 1 ? ` (${tr("Tied")})` : ""}`,
                        ]
                      : [],
                  )
                  .join(" · ") || "—"}
              </td>
              {explain && (
                <td className="small">
                  {tr("MVP: {value0}/6 appearances", {
                    value0: row.appearances,
                  })}
                  <br />
                  {tr(
                    "MIP: {value0}/5 current, {value1}/5 previous; positive gain required",
                    {
                      value0: row.appearances,
                      value1: row.previousAppearances,
                    },
                  )}
                  <br />
                  {tr("Rookie: {value0}/5 appearances; Tier T4/T5+ required", {
                    value0: row.appearances,
                  })}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!candidates.length && (
        <p className="muted">{tr("No eligible appearances in this week.")}</p>
      )}
    </div>
  );
}
