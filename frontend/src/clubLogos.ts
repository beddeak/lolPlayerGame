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
  KT: "/club-logos/kt.png",
  BRO: "/club-logos/bro.png",
  NS: "/club-logos/ns.png",
  BNK: "/club-logos/bnk.png",
  DRX: "/club-logos/drx.png",
  DN: "/club-logos/dn.webp",
  TES: "/club-logos/tes.png",
  JDG: "/club-logos/jdg.png",
  GX: "/club-logos/gx.png",
  KC: "/club-logos/kc.png",
  MKOI: "/club-logos/mkoi.png",
  NAVI: "/club-logos/navi.png",
  SHFT: "/club-logos/shft.png",
  SK: "/club-logos/sk.png",
  TH: "/club-logos/th.png",
  VIT: "/club-logos/vit.png",
  SEN: "/club-logos/sen.png",
  C9: "/club-logos/c9.png",
  DIG: "/club-logos/dig.png",
  DSG: "/club-logos/dsg.png",
  SR: "/club-logos/sr.png",
  TL: "/club-logos/tl.png",
  IG: "/club-logos/ig.png",
  WBG: "/club-logos/wbg.png",
  NIP: "/club-logos/nip.png",
  WE: "/club-logos/we.png",
  EDG: "/club-logos/edg.png",
  TT: "/club-logos/tt.png",
  LGD: "/club-logos/lgd.png",
  LNG: "/club-logos/lng.png",
  TSW: "/club-logos/tsw.png",
  CFO: "/club-logos/cfo.png",
  MVK: "/club-logos/mvk.png",
  GAM: "/club-logos/gam.png",
  GZ: "/club-logos/gz.png",
  DCG: "/club-logos/dcg.png",
  DFM: "/club-logos/dfm.png",
  SHG: "/club-logos/shg.png",
  LOS: "/club-logos/los.png",
  FUR: "/club-logos/fur.png",
  VKS: "/club-logos/vks.png",
  LOUD: "/club-logos/loud.png",
  RED: "/club-logos/red.png",
  PNG: "/club-logos/png.png",
  FX: "/club-logos/fx.png",
  LEV: "/club-logos/lev.png",
  TLAW: "/club-logos/tl.png",
  // Official 2026 tags; existing catalog/save identifiers remain unchanged.
  BFX: "/club-logos/bnk.png",
  KRX: "/club-logos/drx.png",
  DNS: "/club-logos/dn.webp",
  PAIN: "/club-logos/png.png",
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

// The official FURIA asset is black on transparency; keep its original colors.
export function needsLightClubLogoBackground(source: string | null): boolean {
  return source === CLUB_LOGOS.FUR;
}
