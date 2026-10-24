import { publicRoundRatings } from "@/lib/ratings";
import { RoundRatings } from "@/components/round-ratings";
import { getAppTranslations } from "@/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { PlayerProfile } from "@/components/player-profile";
import { publishedPlayerProfile } from "@/lib/player-profiles";
import { modeNames, profileModes } from "@/lib/osu-profile-model";
import { HttpError } from "@/lib/http";
export async function generateMetadata() {
  const tr = await getAppTranslations();
  return { title: tr("Player profile") };
}

export default async function Profile({
  params,
  searchParams,
}: {
  params: Promise<{ osuId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tr = await getAppTranslations();

  const { osuId } = await params;
  const query = await searchParams;
  if (
    Object.keys(query).some((key) => !["mode", "edition"].includes(key)) ||
    (query.mode !== undefined && typeof query.mode !== "string") ||
    (query.edition !== undefined &&
      (typeof query.edition !== "string" ||
        !/^[a-z0-9-]+$/.test(query.edition)))
  )
    notFound();
  let data;
  try {
    data = await publishedPlayerProfile(
      osuId,
      query.mode as string | undefined,
      query.edition as string | undefined,
    );
  } catch (e) {
    if (e instanceof HttpError && [400, 404].includes(e.status)) notFound();
    throw e;
  }
  const ratingHistory =
    typeof query.edition === "string"
      ? (await publicRoundRatings(query.edition))
          .filter((r) =>
            r.report.players.some((p) => p.userId === Number(osuId)),
          )
          .map((r) => ({
            ...r,
            report: {
              ...r.report,
              players: r.report.players.filter(
                (p) => p.userId === Number(osuId),
              ),
            },
          }))
      : [];
  return (
    <div
      className={
        query.edition
          ? "public-tournament public-player-page"
          : "container page"
      }
    >
      <Link
        className="context-link"
        href={
          query.edition
            ? `/tournaments/${query.edition}/players`
            : "/tournaments"
        }
      >
        {query.edition ? tr("← Tournament players") : tr("← Tournaments")}
      </Link>
      <PageHeading
        eyebrow={tr("OCLR PLAYER")}
        title={
          data.snapshot?.profile.username ?? data.participation[0].username
        }
      >
        {tr("Public osu! statistics and published OCLR participation.")}
      </PageHeading>
      <form method="get" className="filters">
        {query.edition && (
          <input type="hidden" name="edition" value={query.edition as string} />
        )}
        <div className="field">
          <label htmlFor="profile-ruleset">{tr("Ruleset")}</label>
          <select
            id="profile-ruleset"
            name="mode"
            defaultValue={data.identity.mode}
          >
            {profileModes.map((mode) => (
              <option key={mode} value={mode}>
                {modeNames[mode]}
              </option>
            ))}
          </select>
        </div>
        <button>{tr("View ruleset")}</button>
      </form>
      {!query.mode && (
        <p className="muted small">
          {tr(
            "Select a ruleset to view its BWS estimate. No tournament mode is inferred.",
          )}
        </p>
      )}
      {data.snapshot ? (
        <PlayerProfile snapshot={data.snapshot} bws={data.bws} />
      ) : (
        <p className="notice" role="status">
          {data.error?.message}{" "}
          {tr(" Published OCLR participation is shown below.")}
        </p>
      )}
      {typeof query.edition === "string" && (
        <RoundRatings data={ratingHistory} slug={query.edition} />
      )}
      <section className="spaced" aria-labelledby="participation">
        <h2 id="participation">{tr("Published participation")}</h2>
        <ul className="player-directory">
          {data.participation.map((p) => (
            <li className="panel" key={p.editionSlug}>
              <h3>
                <Link
                  href={`/tournaments/${p.editionSlug}`}
                  className="context-link"
                >
                  {p.editionName}
                </Link>
              </h3>
              <p>
                {p.participation === "coach"
                  ? tr("Coach")
                  : p.captain
                    ? tr("Captain")
                    : p.participation === "finalized_roster"
                      ? tr("Finalized roster player")
                      : tr("Accepted player")}
              </p>
              {p.coachedTeams?.map((t) => (
                <p key={t.id}>
                  <span className="badge">{tr("Coach")}</span>{" "}
                  <Link
                    className="context-link"
                    href={`/tournaments/${p.editionSlug}/teams/${t.id}`}
                  >
                    {t.name}
                  </Link>
                </p>
              ))}
              {p.participation !== "coach" &&
                (p.team ? (
                  <Link
                    href={`/tournaments/${p.editionSlug}/teams/${p.team.id}`}
                    className="context-link"
                  >
                    {p.team.name}
                  </Link>
                ) : (
                  <p className="muted">{tr("Team awaiting publication")}</p>
                ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
