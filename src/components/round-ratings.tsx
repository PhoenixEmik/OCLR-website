"use client";
import { useState } from "react";
import { useAppTranslations } from "@/i18n/shared";
import type { publicRoundRatings } from "@/lib/ratings";
import { PlayerRatings } from "./player-ratings";
export function RoundRatings({
  data,
  slug,
}: {
  data: Awaited<ReturnType<typeof publicRoundRatings>>;
  slug: string;
}) {
  const tr = useAppTranslations();
  const [selected, setSelected] = useState("");
  const current =
    data.find((r) => `${r.roundId}/${r.groupKey}` === selected) ?? data[0];
  if (!current) return null;
  return (
    <section
      className="section-space stack"
      aria-label={tr("Round YumuRating")}
    >
      <h2>{tr("Round YumuRating")}</h2>
      <label className="field">
        <span>{tr("Competition round")}</span>
        <select
          value={`${current.roundId}/${current.groupKey}`}
          onChange={(e) => setSelected(e.target.value)}
        >
          {data.map((r) => (
            <option
              key={`${r.roundId}/${r.groupKey}`}
              value={`${r.roundId}/${r.groupKey}`}
            >
              {r.stage === "group" ? tr("Group Stage") : tr("Knockout Stage")} ·{" "}
              {r.roundName} · {r.groupName || tr("All groups")}
            </option>
          ))}
        </select>
      </label>
      <p role="status" className="notice">
        {current.complete
          ? tr("All fixtures in this scope have approved rating data.")
          : tr(
              "Provisional: this round has incomplete or unavailable rating data.",
            )}
      </p>
      <p className="muted small">
        {tr("{value0} of {value1} published fixtures have rating data.", {
          value0: current.ratedFixtures,
          value1: current.publishedFixtures,
        })}
      </p>
      <PlayerRatings report={current.report} slug={slug} />
    </section>
  );
}
