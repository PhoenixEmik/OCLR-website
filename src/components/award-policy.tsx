"use client";
import { useId } from "react";
import styles from "./award-policy.module.css";
import { useAppTranslations } from "@/i18n/shared";
export function AwardPolicy({
  policy = "relative-game-mean-v1",
}: {
  policy?: string;
}) {
  const tr = useAppTranslations();
  const id = useId();
  return (
    <section className={styles.policy} aria-labelledby={id}>
      <h2 id={id}>{tr("Award policy and calculation")}</h2>
      <p className="muted small">
        <code>{policy}</code>
      </p>
      <p>
        {policy === "yumu-mra-v1"
          ? tr(
              "One approved scored game is one appearance. Weekly performance is YumuRating MRA recomputed from all approved games in the configured week, without star weighting. The fixture belongs to its scheduled week.",
            )
          : tr(
              "One approved scored game is one appearance. Weekly performance is the mean of each player score divided by the highest eligible score in that game. The entire fixture belongs to the week containing its scheduled time.",
            )}
      </p>
      <ul className={styles.rules}>
        <li>{tr("MVP: at least 6 appearances.")}</li>
        <li>
          {tr(
            "MIP: from week 2, at least 5 appearances in both adjacent weeks and positive absolute improvement.",
          )}
        </li>
        <li>
          {tr(
            "Rookie: at least 5 appearances and draft-derived Tier of T4, T5 or below.",
          )}
        </li>
      </ul>
      <p className={styles.shared}>
        {tr("Awards are independent; ties remain tied.")}
      </p>
      <p className="muted small">
        {policy === "yumu-mra-v1"
          ? tr(
              "MRA is rounded to 9 decimal places. MIP uses the absolute MRA gain between adjacent weeks. Different comparison groups can affect relative ratings. Only reviewed and published awards are public.",
            )
          : tr(
              "Ratios and weekly means are rounded half up to 9 decimal places. Unverified games require review. Only reviewed and published awards are public.",
            )}
      </p>
    </section>
  );
}
