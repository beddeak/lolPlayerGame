import type { ContractOffer, Position } from "./types";

export interface TransferCandidate {
  careerPlayerId: number;
  nickname: string;
  nationality: string;
  currentAge: number;
  position: Position;
  overall: number;
  availability: "FREE_AGENT" | "CONTRACTED";
  currentTeamId: number | null;
  currentTeam: { id: number; code: string; name: string } | null;
  currentContract: { annualSalary: number; endDate: string } | null;
  requiredFee: number;
  activeAgreementId: number | null;
  activeAgreementFee: number | null;
  canNegotiate: boolean;
  hasBenchSpace: boolean;
  blockedReason: string | null;
}
export interface TransferWindow {
  currentDate: string;
  isOpen: boolean;
  opensAt: string;
  endsAt: string;
}
export interface PlayerSale {
  id: number;
  careerPlayerId: number;
  nickname: string;
  status: ContractOffer["status"];
  buyerTeam: { id: number; code: string; name: string };
  transferFee: number;
  responseDate: string;
  reason: string | null;
}
export const isOpenOffer = (offer: { status: ContractOffer["status"] }) =>
  [
    "WAITING_PLAYER_RESPONSE",
    "PLAYER_ACCEPTED",
    "COUNTER_OFFERED",
    "REJECTED",
  ].includes(offer.status);
