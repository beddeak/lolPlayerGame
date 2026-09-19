import { UnauthorizedException } from '@nestjs/common';
import { LoginTicket, OAuth2Client } from 'google-auth-library';
import type { VerifyIdTokenOptions } from 'google-auth-library';
import { GoogleTokenVerifier } from './google-token-verifier.service';

describe('GoogleTokenVerifier', () => {
  // Explicitly select the Promise overload, not the SDK's callback overload.
  const spyOnVerification = () =>
    jest.spyOn(
      OAuth2Client.prototype,
      'verifyIdToken',
    ) as unknown as jest.SpyInstance<
      Promise<LoginTicket>,
      [VerifyIdTokenOptions]
    >;
  afterEach(() => jest.restoreAllMocks());

  it('delegates signature/issuer/audience/expiry verification to the official library', async () => {
    const claims = {
      sub: 'subject',
      email: 'coach@example.com',
      email_verified: true,
      nonce: 'nonce',
    };
    const verify = spyOnVerification().mockResolvedValue({
      getPayload: () => claims,
    } as unknown as LoginTicket);
    await expect(
      new GoogleTokenVerifier().verify('id-token', 'client-id'),
    ).resolves.toEqual(claims);
    expect(verify).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: 'client-id',
    });
  });

  it('does not leak credentials or provider errors on verification failure', async () => {
    spyOnVerification().mockRejectedValue(
      new Error('raw-private-token-and-sdk-error'),
    );
    await expect(
      new GoogleTokenVerifier().verify('private-token', 'client-id'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      new GoogleTokenVerifier().verify('private-token', 'client-id'),
    ).rejects.not.toThrow('private-token');
  });

  it('rejects a missing verified payload', async () => {
    spyOnVerification().mockResolvedValue({
      getPayload: () => undefined,
    } as unknown as LoginTicket);
    await expect(
      new GoogleTokenVerifier().verify('id-token', 'client-id'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
