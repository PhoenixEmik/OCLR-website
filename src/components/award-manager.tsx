"use client";
import {
  ReadOnlyFields,
  MutationButton,
  useStaffReadOnly,
} from "./staff-read-only";
import { useState } from "react";
import { useAppTranslations } from "@/i18n/shared";
import { awardTierLabel } from "@/lib/award-tiers";
import type { awardWorkspace } from "@/lib/awards";
import type { AwardWeek, AwardPolicy as Policy } from "@/lib/award-model";
import { ZonedDateInput } from "./zoned-date-input";
import { AwardPolicy } from "./award-policy";
import { RoundRatings } from "./round-ratings";
import { AwardTable } from "./award-table";
type Data = Awaited<ReturnType<typeof awardWorkspace>>;
export function AwardManager({ initial }: { initial: Data }) {
  const readOnly = useStaffReadOnly();
  const tr = useAppTranslations();
  const [data, setData] = useState(initial),
    [weeks, setWeeks] = useState<AwardWeek[]>(initial.weeks);
  const [policy, setPolicy] = useState<Policy>(initial.policy);
  const [selected, setSelected] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [validity, setValidity] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const dirty =
    JSON.stringify(weeks) !== JSON.stringify(data.weeks) ||
    policy !== data.policy;
  async function send(command: Record<string, unknown>) {
    if (readOnly) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/tournaments/${data.edition.slug}/awards`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...command,
            expectedVersion: data.version,
            confirmed: true,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to save changes.");
      setData(result);
      setWeeks(result.weeks);
      setPolicy(result.policy);
      setNotice("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save changes.");
    } finally {
      setBusy(false);
    }
  }
  const report = data.reports.find((r) => r.number === selected),
    release = data.releases.find((r) => r.week === selected);
  return (
    <div className="form-stack">
      <AwardPolicy policy={policy} />
      <RoundRatings slug={data.edition.slug} data={data.roundRatings} />
      {error && (
        <p role="alert" className="error-text">
          {tr(error)}
        </p>
      )}
      {notice && <p role="status">{tr(notice)}</p>}
      <details className="panel" open={!data.weeks.length}>
        <summary>{tr("Weeks and player Tiers")}</summary>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ action: "configure", weeks, policy });
          }}
        >
          <ReadOnlyFields>
            <label className="field">
              <span>{tr("Rating policy")}</span>
              <select
                value={policy}
                onChange={(e) => setPolicy(e.target.value as Policy)}
              >
                <option value="yumu-mra-v1">{tr("YumuRating")}</option>
                <option value="relative-game-mean-v1">
                  {tr("Legacy relative-score mean")}
                </option>
              </select>
            </label>
          </ReadOnlyFields>
          <p className="muted small">{data.edition.timeZone}</p>
          {weeks.map((week, index) => (
            <ReadOnlyFields key={week.number}>
              <fieldset>
                <legend>{tr("Week {value0}", { value0: week.number })}</legend>
                <div className="form-grid">
                  {(["startsAt", "endsAt"] as const).map((key) => (
                    <ZonedDateInput
                      key={key}
                      label={key === "startsAt" ? tr("Starts") : tr("Ends")}
                      value={week[key] || null}
                      timeZone={data.edition.timeZone}
                      onChange={(value) =>
                        setWeeks((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, [key]: value ?? "" } : r,
                          ),
                        )
                      }
                      onValidityChange={(valid) =>
                        setValidity((state) =>
                          state[`${index}-${key}`] === valid
                            ? state
                            : { ...state, [`${index}-${key}`]: valid },
                        )
                      }
                    />
                  ))}
                </div>
              </fieldset>
            </ReadOnlyFields>
          ))}
          <div className="actions">
            <MutationButton
              type="button"
              className="secondary"
              disabled={busy || weeks.length >= 52}
              onClick={() =>
                setWeeks([
                  ...weeks,
                  { number: weeks.length + 1, startsAt: "", endsAt: "" },
                ])
              }
            >
              {tr("Add week")}
            </MutationButton>
            <MutationButton
              type="button"
              className="secondary"
              disabled={busy || !weeks.length}
              onClick={() => {
                setWeeks(weeks.slice(0, -1));
                setValidity({});
              }}
            >
              {tr("Remove last week")}
            </MutationButton>
          </div>
          <p className="muted small">
            {tr(
              "Captains display as Captain (internal Tier 0). Other players receive Tiers from valid draft rounds.",
            )}
          </p>
          <label className="field">
            {tr("Search players")}
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{tr("Player")}</th>
                  <th>{tr("Tier")}</th>
                </tr>
              </thead>
              <tbody>
                {data.participants
                  .filter((p) =>
                    `${p.username} ${p.userId}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((p) => (
                    <tr key={p.userId}>
                      <th>
                        {p.username}{" "}
                        <span className="muted small">{p.userId}</span>
                      </th>
                      <td>
                        {awardTierLabel(
                          data.tiers.find((t) => t.userId === p.userId)?.tier,
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <MutationButton
            disabled={busy || !dirty || Object.values(validity).some((v) => !v)}
          >
            {tr("Save configuration")}
          </MutationButton>
        </form>
      </details>
      <section className="panel form-stack">
        <label className="field">
          {tr("Review week")}
          <select
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {data.weeks.map((w) => (
              <option key={w.number} value={w.number}>
                {tr("Week {value0}", { value0: w.number })}
              </option>
            ))}
          </select>
        </label>
        {report ? (
          <>
            <p className="muted small">
              {release
                ? release.fingerprint === report.fingerprint
                  ? tr("Published")
                  : tr("Source changed; review required.")
                : tr("Draft")}
            </p>
            {report.issues.map((issue) => (
              <p role="alert" key={issue}>
                {tr(issue)}
              </p>
            ))}
            <details>
              <summary>{tr("Calculation sources")}</summary>
              <ul>
                {report.evidence.map((source) => (
                  <li key={source.gameId}>
                    <a
                      href={`/admin/tournaments/${data.edition.slug}/matches/${source.fixtureId}`}
                    >
                      {source.gameId}
                    </a>{" "}
                    · {tr("Revision {value0}", { value0: source.revision })}{" "}
                    <code>{source.fingerprint.slice(0, 12)}</code>
                  </li>
                ))}
              </ul>
            </details>
            <AwardTable
              explain
              {...report}
              candidates={report.candidates.map((c) => ({
                ...c,
                username: report.identities.find((p) => p.userId === c.userId)!
                  .username,
              }))}
            />
            <div className="actions">
              <MutationButton
                disabled={
                  busy ||
                  dirty ||
                  !!report.issues.length ||
                  release?.fingerprint === report.fingerprint
                }
                onClick={() => {
                  if (
                    window.confirm(
                      tr("Approve and publish this weekly award calculation?"),
                    )
                  )
                    void send({
                      action: "publish",
                      week: selected,
                      fingerprint: report.fingerprint,
                    });
                }}
              >
                {tr("Approve & publish")}
              </MutationButton>
              {release && (
                <MutationButton
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    void send({
                      action: "unpublish",
                      week: selected,
                      releaseId: release.id,
                    });
                  }}
                >
                  {tr("Unpublish")}
                </MutationButton>
              )}
            </div>
          </>
        ) : (
          <p className="muted">
            {tr("Configure award weeks before reviewing results.")}
          </p>
        )}
      </section>
    </div>
  );
}
