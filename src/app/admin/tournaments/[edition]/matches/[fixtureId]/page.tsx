import { matchRatingWorkspace } from "@/lib/ratings";
import { PlayerRatings } from "@/components/player-ratings";
import { getAppTranslations } from "@/i18n/server";
import { authorizedPage } from "@/lib/auth/page";
import { requireUser } from "@/lib/auth/user";
import { staffAccess, canRead } from "@/lib/auth/staff";
import { canViewStreaming, streamingWorkspace } from "@/lib/streaming";
import { StreamingManager } from "@/components/streaming-manager";
import { staffFixtures } from "@/lib/fixtures";
import { fixtureSlot } from "@/lib/fixture-views";
import { HttpError } from "@/lib/http";
import { matchReview } from "@/lib/results";
import { MatchSourceCompletion } from "@/components/match-source-completion";
import { MatchReviewPanel } from "@/components/match-review";
import { formatDate } from "@/lib/editions";
import { PageHeading } from "@/components/ui";
export async function generateMetadata() {
  const tr = await getAppTranslations();
  return { title: tr("Fixture review") };
}

export default async function FixturePage({
  params,
}: {
  params: Promise<{ edition: string; fixtureId: string }>;
}) {
  const tr = await getAppTranslations();

  return authorizedPage(async () => {
    const actor = await requireUser();
    const { edition, fixtureId } = await params;
    const access = await staffAccess(actor);
    const streaming = canViewStreaming(access, edition)
      ? await streamingWorkspace(actor, edition, {}, fixtureId)
      : null;
    const streamingPanel = streaming ? (
      <StreamingManager slug={edition} data={streaming} detail />
    ) : null;
    if (
      streaming &&
      !canRead(access, "manage_fixtures", edition) &&
      !canRead(access, "record_results", edition)
    ) {
      return (
        <>
          <PageHeading
            eyebrow={tr("COMPETITION")}
            title={streaming.fixtures[0].label}
          />
          {streamingPanel}
        </>
      );
    }
    const review = await matchReview(actor, edition, fixtureId).catch(
      async (error: unknown) => {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        const workspace = await staffFixtures(actor, edition);
        const fixture = workspace.fixtures.find((f) => f.id === fixtureId);
        if (
          !fixture ||
          (workspace.teams.some((t) => t.id === fixture.homeTeamId) &&
            workspace.teams.some((t) => t.id === fixture.awayTeamId))
        )
          throw error;
        return { planned: { fixture, workspace } };
      },
    );
    if ("planned" in review) {
      const { fixture, workspace } = review.planned;
      return (
        <>
          <PageHeading eyebrow={tr("PLANNED MATCH")} title={fixture.label}>
            {fixtureSlot(workspace, fixture, "home").label} {tr(" vs")}{" "}
            {fixtureSlot(workspace, fixture, "away").label}
          </PageHeading>
          {streamingPanel}
          <div className="panel form-stack planned-match-panel">
            <p>
              {fixture.scheduledAt
                ? tr(
                    formatDate(
                      fixture.scheduledAt,
                      fixture.timeZone,
                      tr.locale,
                    ),
                  )
                : tr("Match time TBA")}
            </p>
            <p>
              {tr("Assigned referees:")}{" "}
              {fixture.referees.map((r) => r.username).join(", ") || tr("None")}
            </p>
            <MatchSourceCompletion
              slug={edition}
              fixtureId={fixture.id}
              canManage={workspace.canManage}
            />
          </div>
        </>
      );
    }
    const data = review.context;
    const rating = await matchRatingWorkspace(actor, edition, fixtureId).catch(
      (error: unknown) => {
        if (error instanceof HttpError && error.status === 403) return null;
        throw error;
      },
    );
    return (
      <>
        <PageHeading
          eyebrow={tr("{value0} STAGE / {value1}", {
            value0: data.round.stage === "group" ? "GROUP" : "KNOCKOUT",
            value1: data.round.name,
          })}
          title={data.fixture.label}
        >
          {data.teams.map((t) => t.name).join(" vs ")} ·{" "}
          {tr(data.fixture.status)}
        </PageHeading>
        <div className="panel">
          <p>
            {data.fixture.scheduledAt
              ? tr(
                  formatDate(
                    data.fixture.scheduledAt,
                    data.fixture.timeZone,
                    tr.locale,
                  ),
                )
              : tr("Match time TBA ({value0})", {
                  value0: data.fixture.timeZone,
                })}
          </p>
          <p>
            {data.pool
              ? tr("Associated pool: {value0}", { value0: data.pool.name })
              : tr("No mappool associated")}
          </p>
        </div>
        {streamingPanel}
        <MatchReviewPanel data={review} slug={edition} />
        {rating && <PlayerRatings report={rating} slug={edition} />}
      </>
    );
  });
}
