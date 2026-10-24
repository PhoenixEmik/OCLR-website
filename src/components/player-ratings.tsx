"use client";
import Link from "next/link";
import { useAppTranslations } from "@/i18n/shared";
import type { ratingSnapshot } from "@/lib/ratings";
export function PlayerRatings({
  report,
  slug,
}: {
  report: ReturnType<typeof ratingSnapshot>;
  slug: string;
}) {
  const tr = useAppTranslations();
  return (
    <section className="section-space stack" aria-label={tr("YumuRating")}>
      <h2>{tr("YumuRating")}</h2>
      <p className="muted small">
        {tr(
          "MRA combines 70% ERA and 30% DRA. Higher is better. No star weighting is applied.",
        )}
      </p>
      <p className="muted small">
        {report.policy} ·{" "}
        {tr("{value0} scored games · {value1} players", {
          value0: report.gameCount,
          value1: report.playerCount,
        })}
      </p>
      {report.issues.length ? (
        <p role="status" className="notice">
          {tr("Rating unavailable; approved score data needs review.")}
        </p>
      ) : !report.players.length ? (
        <p className="muted">
          {tr("No approved scored games available for rating.")}
        </p>
      ) : (
        <>
          {report.playerCount < 3 && (
            <p className="notice">
              {tr("Small comparison group; interpret this rating with care.")}
            </p>
          )}
          <div
            className="table-scroll"
            role="region"
            tabIndex={0}
            aria-label={tr("Player ratings; scroll horizontally")}
          >
            <table>
              <caption>{tr("Player ratings")}</caption>
              <thead>
                <tr>
                  <th scope="col">{tr("Rank")}</th>
                  <th scope="col">{tr("Player")}</th>
                  <th scope="col">{tr("Appearances")}</th>
                  <th scope="col">{"MRA"}</th>
                  <th scope="col">{"ERA"}</th>
                  <th scope="col">{"DRA"}</th>
                  <th scope="col">{"RWS"}</th>
                </tr>
              </thead>
              <tbody>
                {report.players.map((p) => (
                  <tr key={p.userId}>
                    <td>{p.rank}</td>
                    <th scope="row">
                      <Link
                        className="text-link"
                        href={`/players/${p.userId}?edition=${slug}`}
                      >
                        {p.username}
                      </Link>
                    </th>
                    <td>{p.appearances}</td>
                    <td>
                      <strong>{p.mra.toFixed(4)}</strong>
                    </td>
                    <td>{p.era.toFixed(4)}</td>
                    <td>{p.dra.toFixed(4)}</td>
                    <td>{p.rws.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>{tr("Calculation sources")}</summary>
            <ul>
              {report.evidence.map((g) => (
                <li key={g.gameId}>
                  {tr("Game {value0}", { value0: g.gameId })} ·{" "}
                  {tr("Revision {value0}", { value0: g.revision })}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
