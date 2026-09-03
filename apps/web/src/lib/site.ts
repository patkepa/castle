export type CastleSiteVariant = "personal" | "technical";

export interface CastleSitePresentation {
  variant: CastleSiteVariant;
  name: string;
  descriptor: string;
  homeTitle: string;
  homeDescription: string;
  documentOwner: string;
}

const technicalSectionLabels: Record<string, string> = {
  personal: "Start here",
  wiki: "Platform",
  notes: "Services",
  stash: "Operations",
};

export function getSitePresentation(): CastleSitePresentation {
  if (process.env.CASTLE_SITE_VARIANT === "technical") {
    return {
      variant: "technical",
      name: "Halcyon",
      descriptor: "Engineering handbook",
      homeTitle: "Engineering handbook",
      homeDescription:
        "The shared technical reference for building, operating, and evolving Halcyon systems.",
      documentOwner: "Halcyon Engineering",
    };
  }

  return {
    variant: "personal",
    name: "Castle",
    descriptor: "Knowledge library",
    homeTitle: "Library",
    homeDescription: "A read-only Castle knowledge library.",
    documentOwner: "Castle",
  };
}

export function sectionLabel(
  variant: CastleSiteVariant,
  sectionId: string,
  fallback: string,
) {
  return variant === "technical"
    ? (technicalSectionLabels[sectionId] ?? fallback)
    : fallback;
}
