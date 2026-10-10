import { notFound } from "next/navigation";
import LegalPage from "@/components/legal/LegalPage";
import { EuUkTerms, IndiaTerms, SingaporeTerms, UaeTerms, UsTerms } from "@/components/legal/terms-regions";
import { REGIONS, type RegionSlug } from "@/lib/legal";

export const dynamic = "force-dynamic";

const BODY: Record<RegionSlug, () => JSX.Element> = { india: IndiaTerms, "united-states": UsTerms, uae: UaeTerms, singapore: SingaporeTerms, "eu-uk": EuUkTerms };

export function generateMetadata({ params }: { params: { region: string } }) {
  const r = REGIONS.find(x => x.slug === params.region);
  return { title: r ? `Terms: ${r.name}` : "Terms" };
}

export default function RegionalTerms({ params }: { params: { region: string } }) {
  const r = REGIONS.find(x => x.slug === params.region);
  if (!r) notFound();
  const Body = BODY[r.slug];
  return <LegalPage title={`Terms for ${r.name}`} subtitle="Region-specific terms that apply together with the main Terms of Service."><Body /></LegalPage>;
}
