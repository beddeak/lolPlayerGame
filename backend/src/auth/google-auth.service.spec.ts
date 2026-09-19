import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuthService } from './auth.service';
import { Account } from './entities/account.entity';
import { GoogleAuthAction } from './entities/google-auth-challenge.entity';
import {
  SocialIdentity,
  SocialProvider,
} from './entities/social-identity.entity';
import { GoogleAuthService, GOOGLE_AUTH_COOKIE } from './google-auth.service';
import {
  GoogleTokenVerifier,
  type GoogleTokenClaims,
} from './google-token-verifier.service';

describe('GoogleAuthService', () => {
  const cookie = 'a'.repeat(43);
  const nonce = 'server-generated-nonce';
  const hash = (text: string) =>
    createHash('sha256').update(text).digest('hex');
  const headers = {
    origin: 'http://localhost:5173',
    'x-google-auth': '1',
    cookie: `${GOOGLE_AUTH_COOKIE}=${cookie}`,
  };
  const account = {
    id: 7,
    email: 'coach@example.com',
    displayName: 'Coach',
  } as Account;
  const validClaims: GoogleTokenClaims = {
    sub: 'google-subject',
    email: 'Coach@Example.com',
    email_verified: true,
    name: 'Google Coach',
    nonce,
  };
  let config: Record<string, string>;
  let service: GoogleAuthService;
  const repository = {
    delete: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn((data: unknown) => data),
    save: jest.fn(),
  };
  const manager = {
    existsBy: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((_target: unknown, data: unknown) => data),
    save: jest.fn(),
    update: jest.fn(),
  };
  const dataSource = {
    getRepository: jest.fn(() => repository),
    manager,
    transaction: jest.fn(),
  };
  const verifier = { verify: jest.fn() };
  const auth = { issueAccessToken: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    config = {
      GOOGLE_CLIENT_ID: 'configured-client',
      GOOGLE_ALLOWED_ORIGIN: 'http://localhost:5173',
    };
    repository.delete.mockResolvedValue({ affected: 1 });
    repository.findOneBy.mockResolvedValue({ nonceHash: hash(nonce) });
    repository.save.mockImplementation((data: unknown) =>
      Promise.resolve(data),
    );
    manager.existsBy.mockResolvedValue(false);
    manager.findOne.mockResolvedValue(null);
    manager.save.mockImplementation((target: unknown, data: unknown) =>
      Promise.resolve(target === Account ? account : data),
    );
    manager.update.mockResolvedValue({ affected: 1 });
    dataSource.transaction.mockImplementation(
      (action: (manager: EntityManager) => Promise<unknown>) =>
        action(manager as unknown as EntityManager),
    );
    verifier.verify.mockResolvedValue(validClaims);
    auth.issueAccessToken.mockResolvedValue({
      accessToken: 'local-access-token',
      account,
    });
    service = new GoogleAuthService(
      dataSource as unknown as DataSource,
      { get: (key: string) => config[key] } as ConfigService,
      verifier as unknown as GoogleTokenVerifier,
      auth as unknown as AuthService,
    );
  });

  it('returns only public configuration and fails closed when disabled', async () => {
    config.GOOGLE_CLIENT_ID = '';
    expect(service.getConfig()).toEqual({ enabled: false, clientId: null });
    await expect(
      service.createChallenge({ headers }, GoogleAuthAction.LOGIN),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it.each([
    { ...headers, origin: 'https://attacker.example' },
    { ...headers, origin: undefined },
    { ...headers, origin: 'http://localhost:5173.evil.example' },
    { ...headers, origin: 'null' },
    { ...headers, 'x-google-auth': undefined },
    { ...headers, 'x-google-auth': '1, 1' },
  ])(
    'rejects an invalid browser origin or custom header',
    async (invalidHeaders) => {
      await expect(
        service.login({ headers: invalidHeaders }, 'credential'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.findOneBy).not.toHaveBeenCalled();
      expect(verifier.verify).not.toHaveBeenCalled();
    },
  );

  it('creates random cookie/nonce and persists only their hashes for five minutes', async () => {
    const start = Date.now();
    const result = await service.createChallenge(
      { headers },
      GoogleAuthAction.LOGIN,
    );
    expect(result.cookieValue).toMatch(/^[\w-]{43}$/);
    expect(result.nonce).toMatch(/^[\w-]{43}$/);
    expect(result.cookieValue).not.toBe(result.nonce);
    const stored = repository.create.mock.calls[0][0] as {
      tokenHash: string;
      nonceHash: string;
      action: string;
      accountId: number | null;
      expiresAt: Date;
    };
    expect(stored).toMatchObject({
      tokenHash: hash(result.cookieValue),
      nonceHash: hash(result.nonce),
      action: 'LOGIN',
      accountId: null,
    });
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(start + 300000);
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 300000);
    expect(JSON.stringify(stored)).not.toContain(result.cookieValue);
    expect(JSON.stringify(stored)).not.toContain(result.nonce);
    expect(service.secureCookie()).toBe(false);
    config.GOOGLE_ALLOWED_ORIGIN = 'https://game.example';
    expect(service.secureCookie()).toBe(true);
  });

  it('requires a current account and binds link challenges to it', async () => {
    await expect(
      service.createChallenge({ headers }, GoogleAuthAction.LINK, 7),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    manager.existsBy.mockResolvedValue(true);
    await service.createChallenge({ headers }, GoogleAuthAction.LINK, 7);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: GoogleAuthAction.LINK, accountId: 7 }),
    );
  });

  it.each([
    undefined,
    '',
    'unrelated=abc',
    `${GOOGLE_AUTH_COOKIE}=invalid`,
    `${GOOGLE_AUTH_COOKIE}=${cookie}; ${GOOGLE_AUTH_COOKIE}=${cookie}`,
    `${GOOGLE_AUTH_COOKIE}=%${cookie}`,
    `${GOOGLE_AUTH_COOKIE}=${cookie}=`,
  ])(
    'rejects missing, malformed and duplicate cookies: %s',
    async (invalidCookie) => {
      await expect(
        service.login(
          { headers: { ...headers, cookie: invalidCookie } },
          'credential',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(verifier.verify).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    },
  );

  it('rejects expired or mismatched action/account challenges', async () => {
    repository.findOneBy.mockResolvedValue(null);
    await expect(
      service.link({ headers }, 'credential', 7),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: hash(cookie),
        action: GoogleAuthAction.LINK,
        accountId: 7,
      }),
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects a concurrent replay that lost the atomic consume', async () => {
    repository.delete.mockResolvedValue({ affected: 0 });
    await expect(
      service.login({ headers }, 'credential'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { nonce: undefined },
    { nonce: 'wrong' },
    { sub: '' },
    { sub: ' x ' },
    { sub: 's'.repeat(256) },
    { sub: 10 },
    { email_verified: false },
    { email_verified: 'true' },
    { email: 'not-an-email' },
    { email: undefined },
    { email: `${'e'.repeat(192)}@example.com` },
  ])('consumes then rejects invalid signed claims %j', async (claims) => {
    verifier.verify.mockResolvedValue({ ...validClaims, ...claims });
    await expect(
      service.login({ headers }, 'credential'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.delete).toHaveBeenCalledTimes(1);
    expect(verifier.verify).toHaveBeenCalledWith(
      'credential',
      'configured-client',
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('creates a passwordless account from verified claims and reuses local JWT format', async () => {
    const result = await service.login({ headers }, 'credential');
    expect(manager.create).toHaveBeenCalledWith(Account, {
      email: 'coach@example.com',
      displayName: 'Google Coach',
      passwordHash: null,
    });
    expect(manager.create).toHaveBeenCalledWith(SocialIdentity, {
      provider: SocialProvider.GOOGLE,
      subject: 'google-subject',
      accountId: 7,
      email: 'coach@example.com',
    });
    expect(auth.issueAccessToken).toHaveBeenCalledWith(account);
    expect(result.accessToken).toBe('local-access-token');
    expect(repository.delete.mock.invocationCallOrder[0]).toBeLessThan(
      verifier.verify.mock.invocationCallOrder[0],
    );
  });

  it('sanitizes/limits a name and supplies a safe fallback', async () => {
    verifier.verify.mockResolvedValue({ ...validClaims, name: '\u0000  ' });
    await service.login({ headers }, 'credential');
    expect(manager.create).toHaveBeenCalledWith(
      Account,
      expect.objectContaining({ displayName: '감독' }),
    );
    verifier.verify.mockResolvedValue({ ...validClaims, name: 'a'.repeat(80) });
    await service.login({ headers }, 'credential');
    expect(manager.create).toHaveBeenLastCalledWith(
      SocialIdentity,
      expect.anything(),
    );
    expect(manager.create).toHaveBeenCalledWith(
      Account,
      expect.objectContaining({ displayName: 'a'.repeat(50) }),
    );
  });

  it('requires explicit linking instead of merging a matching local email', async () => {
    manager.existsBy.mockResolvedValue(true);
    await expect(service.login({ headers }, 'credential')).rejects.toThrow(
      '이 이메일로 로그인한 뒤 구글 계정을 연결해주세요.',
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(auth.issueAccessToken).not.toHaveBeenCalled();
  });

  it('logs in an existing stable subject even if Google email changed without changing local email', async () => {
    verifier.verify.mockResolvedValue({
      ...validClaims,
      email: 'new@example.com',
    });
    manager.findOne.mockResolvedValue({ id: 3, accountId: 7, account });
    await service.login({ headers }, 'credential');
    expect(auth.issueAccessToken).toHaveBeenCalledWith(account);
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(SocialIdentity, 3, {
      email: 'new@example.com',
    });
    expect(manager.existsBy).not.toHaveBeenCalled();
  });

  it('recovers a concurrent first-login duplicate only when the same subject now exists', async () => {
    dataSource.transaction.mockRejectedValue(
      new QueryFailedError(
        'insert',
        [],
        Object.assign(new Error('duplicate'), { errno: 1062 }),
      ),
    );
    manager.findOne.mockResolvedValue({ account });
    await expect(
      service.login({ headers }, 'credential'),
    ).resolves.toHaveProperty('accessToken');
    manager.findOne.mockResolvedValue(null);
    await expect(
      service.login({ headers }, 'credential'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('links a Google identity to the authenticated account without editing the account or saves', async () => {
    manager.existsBy.mockImplementation((target: unknown) =>
      Promise.resolve(target === Account),
    );
    await expect(service.link({ headers }, 'credential', 7)).resolves.toEqual({
      linked: true,
      email: 'coach@example.com',
    });
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(manager.save).toHaveBeenCalledWith(
      SocialIdentity,
      expect.objectContaining({ accountId: 7 }),
    );
    expect(auth.issueAccessToken).not.toHaveBeenCalled();
  });

  it('keeps a same-account existing link idempotent', async () => {
    manager.existsBy.mockResolvedValue(true);
    manager.findOne.mockResolvedValue({ id: 3, accountId: 7, account });
    await expect(service.link({ headers }, 'credential', 7)).resolves.toEqual({
      linked: true,
      email: 'coach@example.com',
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects taking another account identity or replacing an existing account link', async () => {
    manager.existsBy.mockResolvedValue(true);
    manager.findOne.mockResolvedValue({ accountId: 99 });
    await expect(
      service.link({ headers }, 'credential', 7),
    ).rejects.toBeInstanceOf(ConflictException);
    manager.findOne.mockResolvedValue(null);
    await expect(
      service.link({ headers }, 'credential', 7),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('exposes no Google subject in link status and checks account existence', async () => {
    await expect(service.status(7)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    manager.existsBy.mockResolvedValue(true);
    repository.findOneBy.mockResolvedValue({
      subject: 'private-subject',
      email: 'google@example.com',
    });
    await expect(service.status(7)).resolves.toEqual({
      linked: true,
      email: 'google@example.com',
    });
    repository.findOneBy.mockResolvedValue(null);
    await expect(service.status(7)).resolves.toEqual({
      linked: false,
      email: null,
    });
  });
});
