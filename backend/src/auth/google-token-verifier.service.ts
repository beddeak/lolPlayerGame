import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleTokenClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  nonce?: unknown;
}

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  async verify(
    credential: string,
    audience: string,
  ): Promise<GoogleTokenClaims> {
    try {
      // Google's library verifies signature, issuer, audience and expiration.
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('Missing ID token payload');
      }
      return payload;
    } catch {
      // Never surface SDK/network errors containing a credential or token data.
      throw new UnauthorizedException(
        '구글 인증을 확인할 수 없습니다. 다시 시도해주세요.',
      );
    }
  }
}
