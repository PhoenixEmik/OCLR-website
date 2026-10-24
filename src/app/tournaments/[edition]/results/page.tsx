import { publicRoundRatings } from "@/lib/ratings";
import { RoundRatings } from "@/components/round-ratings";
import { historicalPage } from "@/components/historical-archive";
import { getAppTranslations } from "@/i18n/server";
import { notFound } from "next/navigation";
import { getPublicEdition } from "@/lib/content";
import { publicCompetition } from "@/lib/public-competition";
import Link from "next/link";
import { PageHeading } from "@/components/ui";
import { PublicMatches, GroupStandings } from "@/components/public-matches";
export async function generateMetadata() {
  const tr = await getAppTranslations();
  return { title: tr("Competition results") };
}

export default async function Results({
  params,
}: {
  params: Promise<{ edition: string }>;
}) {
  const tr = await getAppTranslations();

  const { edition: slug } = await params;
  const archivePage = await historicalPage(slug, "results");
  if (archivePage) return archivePage;
  const edition = await getPublicEdition(slug);
  if (!edition) notFound();
  const data = await publicCompetition(slug);
  return (
    <>
      <PageHeading title={tr("Results")} />
      <p>
        <Link href={`/tournaments/${slug}/results/awards`}>
          {tr("Weekly awards")} →
        </Link>
      </p>
      <PublicMatches
        fixtures={data?.fixtures ?? []}
        slug={slug}
        groups={data?.groups ?? []}
      />
      <RoundRatings slug={slug} data={await publicRoundRatings(slug)} />
      <GroupStandings groups={data?.groups ?? []} slug={slug} />
    </>
  );
}
