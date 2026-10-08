import { notFound } from "next/navigation";
import LegalPage from "@/components/legal/LegalPage";
import { EuUkPrivacy, IndiaPrivacy, SingaporePrivacy, UaePrivacy, UsPrivacy } from "@/components/legal/privacy-regions";
import { REGIONS, type RegionSlug } from "@/lib/legal";

export const dynamic = "force-dynamic";

const BODY: Record<RegionSlug, () => JSX.Element> = { india: IndiaPrivacy, "united-states": UsPrivacy, uae: UaePrivacy, singapore: SingaporePrivacy, "eu-uk": EuUkPrivacy };

export function generateMetadata({ params }: { params: { region: string } }) {
  const r = REGIONS.find(x => x.slug === params.region);
  return { title: r ? `Privacy notice: ${r.name}` : "Privacy notice" };
}

export default function RegionalPrivacy({ params }: { params: { region: string } }) {
  const r = REGIONS.find(x => x.slug === params.region);
  if (!r) notFound();
  const Body = BODY[r.slug];
  return <LegalPage title={`Privacy notice: ${r.name}`} subtitle={`Applies together with the main Privacy Policy. Governing privacy law: ${r.law}.`}><Body /></LegalPage>;
}
