import { publicMatchRating } from "@/lib/ratings";
import { PlayerRatings } from "@/components/player-ratings";
import { historicalPage } from "@/components/historical-archive";
import { getAppTranslations } from "@/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicFixture } from "@/lib/public-competition";
import { formatDate } from "@/lib/editions";
import { PageHeading } from "@/components/ui";
export async function generateMetadata() {
  const tr = await getAppTranslations();
  return { title: tr("Match details") };
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ edition: string; fixtureId: string }>;
}) {
  const tr = await getAppTranslations();

  const { edition: slug, fixtureId } = await params;
  const archivePage = await historicalPage(slug, "match", fixtureId);
  if (archivePage) return archivePage;
  const f = await publicFixture(slug, fixtureId);
  if (!f) notFound();
  const result = f.result;
  const rating = result ? await publicMatchRating(slug, fixtureId) : null;
  const teamName = (id: string | null) =>
    id === f.home.team?.id
      ? f.home.label
      : id === f.away.team?.id
        ? f.away.label
        : "Unresolved";
  return (
    <>
      <Link className="text-link" href={`/tournaments/${slug}/results`}>
        {tr("← All matches")}
      </Link>
      <PageHeading
        eyebrow={`${f.stage === "group" ? "GROUP STAGE" : "KNOCKOUT STAGE"} / ${f.roundName}`}
        title={f.label}
      >
        {f.status === "cancelled"
          ? tr("Cancelled — no winner assumed")
          : result
            ? tr("Approved and published result")
            : tr("Awaiting published result")}
      </PageHeading>
      <section className="panel stack">
        <div className="match-versus">
          <span>
            {f.home.team ? (
              <Link
                className="text-link"
                href={`/tournaments/${slug}/teams/${f.home.team.id}`}
              >
                {f.home.label}
              </Link>
            ) : (
              f.home.label
            )}
          </span>
          <strong>
            {result ? `${result.homeWins} : ${result.awayWins}` : tr("vs")}
          </strong>
          <span>
            {f.away.team ? (
              <Link
                className="text-link"
                href={`/tournaments/${slug}/teams/${f.away.team.id}`}
              >
                {f.away.label}
              </Link>
            ) : (
              f.away.label
            )}
          </span>
        </div>
        <p>
          {f.scheduledAt
            ? tr(formatDate(f.scheduledAt, f.timeZone, tr.locale))
            : tr("Match time TBA")}
        </p>
        {f.pool && (
          <Link
            className="text-link"
            href={`/tournaments/${slug}/mappools/${f.pool.id}`}
          >
            {tr("Released mappool: ")}
            {f.pool.name}
          </Link>
        )}
        {!f.confirmed && (
          <p className="notice">
            {tr(
              "This fixture awaits confirmation against published progression. No score or multiplayer source is shown until the teams agree with the approved record.",
            )}
          </p>
        )}
        {result ? (
          <>
            <p>
              {result.draw
                ? tr("Approved draw")
                : tr("Winner: {value0}", {
                    value0: teamName(result.winnerTeamId),
                  })}
            </p>
            {result.publicNote && <p className="notice">{result.publicNote}</p>}
            <a
              className="text-link"
              href={result.mpUrl}
              target="_blank"
              rel="noreferrer"
            >
              {tr("osu! multiplayer source #")}
              {result.mpId} ↗
            </a>
            <p className="muted small">
              {tr("Published · Updated")}{" "}
              {tr(formatDate(result.updatedAt, f.timeZone, tr.locale))}
            </p>
          </>
        ) : (
          <p className="muted">
            {tr(
              "Scores and source links appear after separate review, approval and publication.",
            )}
          </p>
        )}
      </section>
      {rating && <PlayerRatings report={rating} slug={slug} />}
      {result && (
        <section className="section-space stack">
          <h2>{tr("Played maps")}</h2>
          {result.games.map((g, i) => (
            <article className="panel" key={g.gameId}>
              <p className="eyebrow">
                {tr("MAP ")}
                {i + 1} · {g.mods.join(" / ") || "NM"} · {g.scoringType}
              </p>
              <h3>
                {g.beatmap?.artist ? `${g.beatmap.artist} — ` : ""}
                {g.beatmap?.title ?? tr("Beatmap unavailable")}
              </h3>
              <p className="muted">{g.beatmap?.difficulty}</p>
              {g.beatmapId && (
                <a
                  className="text-link"
                  href={`https://osu.ppy.sh/beatmaps/${g.beatmapId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr("Beatmap ")}
                  {g.beatmapId} ↗
                </a>
              )}
              <p>
                {f.home.label}: {g.homeScore.toLocaleString("en")} ·{" "}
                {f.away.label}: {g.awayScore.toLocaleString("en")}
              </p>
              <p>
                {g.tied
                  ? tr("Approved tied map")
                  : tr("Map winner: {value0}", {
                      value0: teamName(g.winnerTeamId),
                    })}
              </p>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
