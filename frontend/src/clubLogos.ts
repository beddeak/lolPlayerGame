export interface ClubIdentity {
  code: string;
  clubCode?: string | null;
  logoUrl?: string | null;
}

const CLUB_LOGOS: Readonly<Record<string, string>> = {
  T1: "/club-logos/t1.png",
  HLE: "/club-logos/hle.png",
  GEN: "/club-logos/gen.png",
  DK: "/club-logos/dk.png",
  BLG: "/club-logos/blg.png",
  AL: "/club-logos/al.png",
  G2: "/club-logos/g2.png",
  FNC: "/club-logos/fnc.png",
  LYON: "/club-logos/lyon.png",
  FLY: "/club-logos/fly.png",
};
const OFFICIAL_LOGO_PATHS = new Set(Object.values(CLUB_LOGOS));

// Older saves have no logoUrl, but still use the same official club codes.
export function getClubLogoUrl(club: ClubIdentity): string | null {
  const customUrl = club.logoUrl?.trim();
  if (customUrl) return customUrl;
  const code = (club.clubCode || club.code).trim().toUpperCase();
  return Object.hasOwn(CLUB_LOGOS, code) ? CLUB_LOGOS[code] : null;
}

export function isOfficialClubLogo(source: string | null): boolean {
  return source !== null && OFFICIAL_LOGO_PATHS.has(source);
}
