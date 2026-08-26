import type { Request } from 'express';

export interface AuthenticatedAccount {
  id: number;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  account: AuthenticatedAccount;
}

export interface AccessTokenPayload {
  sub: number;
  email: string;
}
