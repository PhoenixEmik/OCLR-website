import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { readTournament } from "./tournaments";
import type { RatingReader } from "./approved-rating-games";
import { db } from "@/db";
import {
  captains,
  mappools,
  fixtures,
  matchImports,
  matchResults,
  resultRevisions,
  teams,
  tournamentRounds,
  tournamentStages,
} from "@/db/schema";
import { getPublicEdition } from "./content";
import {
  groupConfigurationSchema,
  standingsRulesSchema,
  type StandingsRules,
} from "./competition-model";
import { reviewedResultSchema } from "./match-model";
import { calculateStandings } from "./standings";
export type PublicTeam = {
  id: string;
  name: string;
  avatarKey?: string | null;
};
export type PublicSlot = {
  team: PublicTeam | null;
  label: string;
  sourceId: string | null;
  outcome: "winner" | "loser" | null;
};
export type PublicMatchResult = {
  revision: number;
  homeWins: number;
  awayWins: number;
  tiedMaps: number;
  winnerTeamId: string | null;
  draw: boolean;
  games: {
    gameId: number;
    beatmapId: number | null;
    beatmap: {
      setId: number | null;
      title: string | null;
      artist: string | null;
      difficulty: string | null;
    } | null;
    mods: string[];
    scoringType: string | null;
    homeScore: number;
    awayScore: number;
    winnerTeamId: string | null;
    tied: boolean;
  }[];
  mpId: number;
  mpUrl: string;
  publicNote: string;
  updatedAt: string;
};
export type PublicFixture = {
  pool: { id: string; name: string } | null;
  id: string;
  label: string;
  publishedAt: string;
  roundId: string;
  roundName: string;
  roundPosition: number;
  stageId: string;
  stage: "group" | "knockout";
  position: number;
  home: PublicSlot;
  away: PublicSlot;
  confirmed: boolean;
  scheduledAt: string | null;
  timeZone: string;
  status: "scheduled" | "in_progress" | "cancelled";
  result: PublicMatchResult | null;
  updatedAt: string;
};
export async function publicCompetition(slug: string, reader?: RatingReader) {
  if (
    !(reader
      ? await readTournament(slug, reader, true)
      : await getPublicEdition(slug))
  )
    return null;
  if (!process.env.DATABASE_URL)
    return {
      fixtures: [] as PublicFixture[],
      groups: [] as PublicGroup[],
      databaseAuthority: false,
    };
  const projectCompetition = async (tx: RatingReader) => {
    const [configured] = await tx
      .select({ id: fixtures.id })
      .from(fixtures)
      .where(eq(fixtures.editionSlug, slug))
      .limit(1);
    const identities = await tx
      .select({ id: teams.id, name: teams.name, avatarKey: teams.avatarKey })
      .from(teams)
      .innerJoin(
        captains,
        and(
          eq(captains.editionSlug, teams.editionSlug),
          eq(captains.userId, teams.captainId),
          eq(captains.published, true),
        ),
      )
      .where(
        and(
          eq(teams.editionSlug, slug),
          eq(teams.identityPublished, true),
          eq(teams.rosterPublished, true),
          isNotNull(teams.finalizedAt),
          isNull(teams.archivedAt),
        ),
      );
    // Publication and approval predicates are enforced in SQL, before any public projection.
    const rows = await tx
      .select({
        fixture: fixtures,
        round: tournamentRounds,
        stage: tournamentStages.kind,
        proposal: resultRevisions.proposal,
        approvedAt: resultRevisions.approvedAt,
        revision: resultRevisions.revision,
        resultPublishedAt: matchResults.publishedAt,
        mpId: matchImports.externalMatchId,
        publicPoolId: mappools.id,
        publicPoolName: mappools.name,
      })
      .from(fixtures)
      .innerJoin(tournamentRounds, eq(tournamentRounds.id, fixtures.roundId))
      .innerJoin(
        tournamentStages,
        eq(tournamentStages.id, tournamentRounds.stageId),
      )
      .leftJoin(
        mappools,
        and(
          eq(mappools.id, fixtures.mappoolId),
          eq(mappools.roundId, fixtures.roundId),
          eq(mappools.editionSlug, slug),
          isNotNull(mappools.publishedAt),
        ),
      )
      .leftJoin(
        matchResults,
        and(
          eq(matchResults.fixtureId, fixtures.id),
          isNotNull(matchResults.publishedAt),
          isNotNull(matchResults.publishedRevision),
        ),
      )
      .leftJoin(
        resultRevisions,
        and(
          eq(resultRevisions.fixtureId, fixtures.id),
          eq(resultRevisions.revision, matchResults.publishedRevision),
          isNotNull(resultRevisions.approvedAt),
          isNotNull(resultRevisions.approvedBy),
        ),
      )
      .leftJoin(
        matchImports,
        and(
          eq(matchImports.id, resultRevisions.importId),
          eq(matchImports.fixtureId, fixtures.id),
        ),
      )
      .where(
        and(eq(fixtures.editionSlug, slug), isNotNull(fixtures.publishedAt)),
      )
      .orderBy(
        asc(tournamentStages.kind),
        asc(tournamentRounds.position),
        asc(fixtures.position),
      );
    const cache = new Map<string, PublicFixture | null>();
    const visiting = new Set<string>();
    function project(id: string): PublicFixture | null {
      if (cache.has(id)) return cache.get(id)!;
      if (visiting.has(id)) return null;
      const row = rows.find((r) => r.fixture.id === id);
      if (!row) return null;
      visiting.add(id);
      const f = row.fixture;
      const slot = (side: "home" | "away"): PublicSlot => {
        const sourceId = side === "home" ? f.homeSourceId : f.awaySourceId;
        const outcome =
          side === "home" ? f.homeSourceOutcome : f.awaySourceOutcome;
        const teamId = side === "home" ? f.homeTeamId : f.awayTeamId;
        if (!sourceId) {
          const team = identities.find((t) => t.id === teamId) ?? null;
          return {
            team,
            label: team?.name ?? "To be announced",
            sourceId: null,
            outcome: null,
          };
        }
        const parent = project(sourceId);
        const winner = parent?.result?.winnerTeamId;
        const resolvedId =
          winner && outcome === "loser"
            ? [parent!.home.team?.id, parent!.away.team?.id].find(
                (t) => t && t !== winner,
              )
            : winner;
        const team = identities.find((t) => t.id === resolvedId) ?? null;
        return {
          team,
          label:
            team?.name ??
            (parent
              ? `${outcome === "loser" ? "Loser" : "Winner"} of ${parent.label}`
              : "To be announced"),
          sourceId: parent?.id ?? null,
          outcome: parent ? outcome : null,
        };
      };
      const home = slot("home");
      const away = slot("away");
      // A direct unpublished team withholds its fixture; progression slots never reveal stored future assignments.
      if (
        (!f.homeSourceId && f.homeTeamId !== null && !home.team) ||
        (!f.awaySourceId && f.awayTeamId !== null && !away.team)
      ) {
        visiting.delete(id);
        cache.set(id, null);
        return null;
      }
      const confirmed = Boolean(
        home.team &&
        away.team &&
        home.team.id !== away.team.id &&
        home.team.id === f.homeTeamId &&
        away.team.id === f.awayTeamId,
      );
      const parsed = reviewedResultSchema.safeParse(row.proposal);
      const p = parsed.success ? parsed.data : null;
      const aligned =
        p &&
        p.roundId === f.roundId &&
        p.teamIds[0] === f.homeTeamId &&
        p.teamIds[1] === f.awayTeamId;
      const result: PublicMatchResult | null =
        confirmed &&
        f.status !== "cancelled" &&
        aligned &&
        row.approvedAt &&
        row.resultPublishedAt &&
        row.mpId &&
        row.revision
          ? {
              revision: row.revision,
              homeWins: p!.series.homeWins,
              awayWins: p!.series.awayWins,
              tiedMaps: p!.series.tiedMaps,
              winnerTeamId: p!.series.winnerTeamId,
              draw: p!.series.draw,
              games: p!.games.map((g) => ({
                gameId: g.gameId,
                beatmapId: g.beatmapId,
                beatmap: g.beatmap,
                mods: g.mods,
                scoringType: g.scoringType,
                homeScore: g.homeScore,
                awayScore: g.awayScore,
                winnerTeamId: g.winnerTeamId,
                tied: g.tied,
              })),
              mpId: row.mpId,
              mpUrl: `https://osu.ppy.sh/community/matches/${row.mpId}`,
              publicNote: p!.publicNote,
              updatedAt: row.resultPublishedAt.toISOString(),
            }
          : null;
      const projected: PublicFixture = {
        pool:
          row.publicPoolId && row.publicPoolName
            ? { id: row.publicPoolId, name: row.publicPoolName }
            : null,
        id,
        label: f.label,
        publishedAt: f.publishedAt!.toISOString(),
        roundId: row.round.id,
        roundName: row.round.name,
        roundPosition: row.round.position,
        stageId: row.round.stageId,
        stage: row.stage,
        position: f.position,
        home,
        away,
        confirmed,
        // Explicitly published TBD schedules are useful; stale confirmed-team lineage still withholds its time.
        scheduledAt:
          confirmed || f.homeTeamId === null || f.awayTeamId === null
            ? (f.scheduledAt?.toISOString() ?? null)
            : null,
        timeZone: f.timeZone,
        status: f.status,
        result,
        updatedAt: (row.resultPublishedAt ?? f.updatedAt).toISOString(),
      };
      visiting.delete(id);
      cache.set(id, projected);
      return projected;
    }
    const published = rows
      .map((r) => project(r.fixture.id))
      .filter((f): f is PublicFixture => f !== null);
    const stages = await tx
      .select()
      .from(tournamentStages)
      .where(
        and(
          eq(tournamentStages.editionSlug, slug),
          eq(tournamentStages.kind, "group"),
          isNotNull(tournamentStages.groupsPublishedAt),
        ),
      );
    const groups: PublicGroup[] = [];
    for (const stage of stages) {
      const config = groupConfigurationSchema.safeParse(
        stage.groupConfiguration,
      );
      if (!config.success) continue;
      for (const group of config.data.groups) {
        const members = group.teamIds.map((id) =>
          identities.find((t) => t.id === id),
        );
        if (members.some((t) => !t)) continue;
        const matches = published.filter(
          (f) =>
            f.stageId === stage.id &&
            f.home.team &&
            f.away.team &&
            group.teamIds.includes(f.home.team.id) &&
            group.teamIds.includes(f.away.team.id),
        );
        const rules = new Map<string, StandingsRules | null>();
        for (const f of matches) {
          const parsed = standingsRulesSchema.safeParse(
            rows.find((r) => r.fixture.id === f.id)?.round.standingsRules,
          );
          rules.set(f.roundId, parsed.success ? parsed.data : null);
        }
        groups.push({
          key: group.key,
          name: group.name,
          version: config.data.version,
          ...calculateStandings(members as PublicTeam[], matches, rules),
        });
      }
    }
    return {
      fixtures: published,
      groups,
      databaseAuthority: Boolean(configured),
    };
  };
  return reader
    ? projectCompetition(reader)
    : db().transaction(projectCompetition, {
        isolationLevel: "repeatable read",
      });
}
export type PublicGroup = {
  key: string;
  name: string;
  version: string;
} & ReturnType<typeof calculateStandings>;
export async function publicFixture(slug: string, id: string) {
  return (
    (await publicCompetition(slug))?.fixtures.find((f) => f.id === id) ?? null
  );
}
