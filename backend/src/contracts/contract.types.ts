import { Position } from '../players/enums/position.enum';

export enum ContractOfferStatus {
  WAITING_PLAYER_RESPONSE = 'WAITING_PLAYER_RESPONSE',
  PLAYER_ACCEPTED = 'PLAYER_ACCEPTED',
  COUNTER_OFFERED = 'COUNTER_OFFERED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
  SIGNED = 'SIGNED',
}

export enum ContractOfferType {
  RENEWAL = 'RENEWAL',
  FREE_AGENT = 'FREE_AGENT',
  TRANSFER = 'TRANSFER',
}

export enum PlayerContractStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  TERMINATED = 'TERMINATED',
}

export enum ContractDecisionAction {
  ACCEPT = 'ACCEPT',
  COUNTER = 'COUNTER',
  KEEP = 'KEEP',
  WITHDRAW = 'WITHDRAW',
  REQUEST_TIME = 'REQUEST_TIME',
}

export enum ContractExpectedRole {
  CORE = 'CORE',
  STARTER = 'STARTER',
  ROTATION = 'ROTATION',
  PROSPECT = 'PROSPECT',
}

export enum ContractPromiseType {
  STARTER_GUARANTEE = 'STARTER_GUARANTEE',
  CARRY_ROLE = 'CARRY_ROLE',
  STRENGTHEN_TEAM = 'STRENGTHEN_TEAM',
  SIGN_POSITION = 'SIGN_POSITION',
}

export interface ContractPromise {
  type: ContractPromiseType;
  position?: Position;
}

export interface ContractTerms {
  /** Annual salary in ten thousand KRW (만원), not KRW. */
  annualSalary: number;
  years: number;
  starterGuarantee: boolean;
  expectedRole: ContractExpectedRole;
  promises: ContractPromise[];
}

export interface ContractResponse {
  kind: 'ACCEPTED' | 'COUNTER_OFFER' | 'REJECTED';
  reason: string;
  evaluatedDate: string;
}

export interface ContractPromiseRecord extends ContractPromise {
  status: 'PENDING';
}

export interface ContractOfferHistoryEntry {
  action: string;
  date: string;
  revision: number;
  terms: ContractTerms;
}
