import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In, Like } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application.setup';
import { Account } from '../src/auth/entities/account.entity';
import { GoogleAuthChallenge } from '../src/auth/entities/google-auth-challenge.entity';
import { SocialIdentity } from '../src/auth/entities/social-identity.entity';
import { GOOGLE_AUTH_COOKIE } from '../src/auth/google-auth.service';
import {
  GoogleTokenClaims,
  GoogleTokenVerifier,
} from '../src/auth/google-token-verifier.service';
import { Career } from '../src/careers/entities/career.entity';
import { CareerTeam } from '../src/careers/entities/career-team.entity';
import { Region } from '../src/careers/enums/region.enum';

interface AuthResult {
  accessToken: string;
  account: { id: number; email: string; displayName: string };
}

interface BrowserChallenge {
  nonce: string;
  cookie: string;
  tokenHash: string;
}

const json = <T>(response: { body: unknown }): T => response.body as T;

describe('Google login and explicit linking against real MySQL (e2e)', () => {
  jest.setTimeout(120_000);
  const prefix = `google_${Date.now()}_${process.pid}`;
  const origin = 'http://localhost:5173';
  const clientId = '123-e2e.apps.googleusercontent.com';
  const password = 'Google-e2e-local-password';
  const claims = new Map<string, GoogleTokenClaims>();
  const challengeHashes: string[] = [];
  const verifier = {
    verify: jest.fn((credential: string, audience: string) => {
      expect(audience).toBe(clientId);
      const payload = claims.get(credential);
      if (!payload)
        throw new UnauthorizedException('Invalid Google credential');
      return Promise.resolve(payload);
    }),
  };
  let serial = 0;
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let config: ConfigService;
  let originalClientId: string | undefined;
  let originalOrigin: string | undefined;
  let isolatedDatabaseVerified = false;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const browser = () => ({ Origin: origin, 'X-Google-Auth': '1' });
  const email = (label: string) => `${prefix}_${label}@example.com`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleTokenVerifier)
      .useValue(verifier)
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    dataSource = app.get(DataSource);
    // Every fixture/mutation is forbidden on the developer's persistent DB.
    if (
      !/^lol_manager_e2e_[0-9]+_[0-9]+$/.test(
        String(dataSource.options.database ?? ''),
      )
    ) {
      throw new Error('Google auth E2E requires npm run test:e2e:isolated');
    }
    isolatedDatabaseVerified = true;
    config = app.get(ConfigService);
    originalClientId = config.get<string>('GOOGLE_CLIENT_ID');
    originalOrigin = config.get<string>('GOOGLE_ALLOWED_ORIGIN');
  });

  beforeEach(() => {
    if (!isolatedDatabaseVerified) throw new Error('Isolated DB not verified');
    config.set('GOOGLE_CLIENT_ID', clientId);
    config.set('GOOGLE_ALLOWED_ORIGIN', origin);
    verifier.verify.mockClear();
  });

  async function challenge(token?: string): Promise<BrowserChallenge> {
    const response = await api()
      .post(token ? '/auth/google/link-challenge' : '/auth/google/challenge')
      .set(browser())
      .set(token ? auth(token) : {})
      .send({})
      .expect(200);
    const body = json<{ nonce: string; expiresInSeconds: number }>(response);
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.expiresInSeconds).toBe(300);
    expect(response.headers['cache-control']).toBe('no-store');
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(cookies[0]).toContain('Path=/');
    const cookie = cookies[0].split(';')[0];
    const tokenHash = createHash('sha256')
      .update(cookie.slice(GOOGLE_AUTH_COOKIE.length + 1))
      .digest('hex');
    challengeHashes.push(tokenHash);
    return { nonce: body.nonce, cookie, tokenHash };
  }

  function credential(
    attempt: BrowserChallenge,
    label: string,
    overrides: GoogleTokenClaims = {},
  ): string {
    const value = `e2e-credential-${prefix}-${++serial}`;
    claims.set(value, {
      sub: `${prefix}_${label}`,
      email: email(label),
      email_verified: true,
      name: 'Google Coach',
      nonce: attempt.nonce,
      ...overrides,
    });
    return value;
  }

  function googleRequest(
    attempt: BrowserChallenge,
    value: string,
    token?: string,
  ) {
    return api()
      .post(token ? '/auth/google/link' : '/auth/google/login')
      .set(browser())
      .set(token ? auth(token) : {})
      .set('Cookie', attempt.cookie)
      .send({ credential: value });
  }

  async function googleLogin(label: string): Promise<AuthResult> {
    const attempt = await challenge();
    return json<AuthResult>(
      await googleRequest(attempt, credential(attempt, label)).expect(200),
    );
  }

  async function localAccount(label: string): Promise<AuthResult> {
    return json<AuthResult>(
      await api()
        .post('/auth/register')
        .send({ email: email(label), password, displayName: 'Local Coach' })
        .expect(201),
    );
  }

  async function passwordHash(accountId: number): Promise<string | null> {
    const account = await dataSource
      .getRepository(Account)
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .where('account.id = :accountId', { accountId })
      .getOneOrFail();
    return account.passwordHash;
  }

  async function ownedSave(accountId: number): Promise<Career> {
    const career = await dataSource.getRepository(Career).save({
      accountId,
      startYear: 2026,
      currentYear: 2027,
      currentDate: '2027-07-29',
    });
    await dataSource.getRepository(CareerTeam).save({
      careerId: career.id,
      code: 'E2E_GOOGLE',
      name: 'Preserved Save',
      region: Region.LCK,
      isUserControlled: true,
    });
    return career;
  }

  it('returns public configuration and safely disables unconfigured Google endpoints', async () => {
    expect(json(await api().get('/auth/google/config').expect(200))).toEqual({
      enabled: true,
      clientId,
    });
    config.set('GOOGLE_CLIENT_ID', '');
    expect(json(await api().get('/auth/google/config').expect(200))).toEqual({
      enabled: false,
      clientId: null,
    });
    const before = await dataSource.getRepository(GoogleAuthChallenge).count();
    await api()
      .post('/auth/google/challenge')
      .set(browser())
      .send({})
      .expect(503);
    await api()
      .post('/auth/google/login')
      .set(browser())
      .send({ credential: 'invalid' })
      .expect(503);
    expect(await dataSource.getRepository(GoogleAuthChallenge).count()).toBe(
      before,
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('creates a passwordless Google account and uses normal JWT/save ownership', async () => {
    const loggedIn = await googleLogin('new');
    expect(await passwordHash(loggedIn.account.id)).toBeNull();
    expect(JSON.stringify(loggedIn)).not.toMatch(
      /passwordHash|credential|subject/,
    );
    expect(
      json(
        await api().get('/auth/me').set(auth(loggedIn.accessToken)).expect(200),
      ),
    ).toEqual(loggedIn.account);
    const save = await ownedSave(loggedIn.account.id);
    expect(
      json(
        await api().get('/careers').set(auth(loggedIn.accessToken)).expect(200),
      ),
    ).toEqual([
      expect.objectContaining({ id: save.id, currentDate: '2027-07-29' }),
    ]);
    await api()
      .get(`/careers/${save.id}`)
      .set(auth(loggedIn.accessToken))
      .expect(200);
    const other = await localAccount('owner-other');
    await api()
      .get(`/careers/${save.id}`)
      .set(auth(other.accessToken))
      .expect(404);
    expect(
      json(
        await api().get('/careers').set(auth(other.accessToken)).expect(200),
      ),
    ).toEqual([]);
    await api()
      .post('/auth/login')
      .send({ email: loggedIn.account.email, password })
      .expect(401);
    await api()
      .post('/auth/register')
      .send({
        email: loggedIn.account.email,
        password,
        displayName: 'Overwrite',
      })
      .expect(409);
    expect(await passwordHash(loggedIn.account.id)).toBeNull();
  });

  it('uses stable Google subject when the verified email changes', async () => {
    const first = await googleLogin('stable');
    const attempt = await challenge();
    const second = json<AuthResult>(
      await googleRequest(
        attempt,
        credential(attempt, 'stable', {
          email: email('changed'),
        }),
      ).expect(200),
    );
    expect(second.account).toEqual(first.account);
    expect(
      await dataSource
        .getRepository(SocialIdentity)
        .findOneByOrFail({ accountId: first.account.id }),
    ).toMatchObject({ email: email('changed') });
    expect(
      await dataSource
        .getRepository(Account)
        .countBy({ email: email('changed') }),
    ).toBe(0);
  });

  it('does not merge an existing local account by matching email', async () => {
    const local = await localAccount('collision');
    const beforePassword = await passwordHash(local.account.id);
    const save = await ownedSave(local.account.id);
    const attempt = await challenge();
    await googleRequest(attempt, credential(attempt, 'collision')).expect(409);
    expect(await passwordHash(local.account.id)).toBe(beforePassword);
    expect(
      await dataSource
        .getRepository(SocialIdentity)
        .countBy({ accountId: local.account.id }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(Career).findOneByOrFail({ id: save.id }),
    ).toEqual(save);
  });

  it('explicitly links Google to the existing account without changing password or saves', async () => {
    const local = await localAccount('link');
    const beforePassword = await passwordHash(local.account.id);
    const save = await ownedSave(local.account.id);
    const attempt = await challenge(local.accessToken);
    expect(
      json(
        await googleRequest(
          attempt,
          credential(attempt, 'link'),
          local.accessToken,
        ).expect(200),
      ),
    ).toEqual({ linked: true, email: email('link') });
    expect(
      json(
        await api()
          .get('/auth/google/status')
          .set(auth(local.accessToken))
          .expect(200),
      ),
    ).toEqual({ linked: true, email: email('link') });
    const viaGoogle = await googleLogin('link');
    expect(viaGoogle.account).toEqual(local.account);
    expect(await passwordHash(local.account.id)).toBe(beforePassword);
    expect(
      await dataSource.getRepository(Career).findOneByOrFail({ id: save.id }),
    ).toEqual(save);
    expect(
      json(
        await api()
          .get('/careers')
          .set(auth(viaGoogle.accessToken))
          .expect(200),
      ),
    ).toEqual([expect.objectContaining({ id: save.id })]);
    expect(
      json<AuthResult>(
        await api()
          .post('/auth/login')
          .send({ email: email('link'), password })
          .expect(200),
      ).account.id,
    ).toBe(local.account.id);
  });

  it('binds a link challenge to the authenticated account and action', async () => {
    const owner = await localAccount('bound-owner');
    const other = await localAccount('bound-other');
    const attempt = await challenge(owner.accessToken);
    const value = credential(attempt, 'bound-owner');
    await googleRequest(attempt, value, other.accessToken).expect(401);
    await googleRequest(attempt, value).expect(401);
    expect(verifier.verify).not.toHaveBeenCalled();
    await googleRequest(attempt, value, owner.accessToken).expect(200);
    const loginAttempt = await challenge();
    const loginValue = credential(loginAttempt, 'login-action');
    await googleRequest(loginAttempt, loginValue, owner.accessToken).expect(
      401,
    );
    await googleRequest(loginAttempt, loginValue).expect(200);
  });

  it('rejects identity stealing and replacing an already linked Google identity', async () => {
    const owner = await googleLogin('exclusive');
    const other = await localAccount('exclusive-other');
    const stolen = await challenge(other.accessToken);
    await googleRequest(
      stolen,
      credential(stolen, 'exclusive'),
      other.accessToken,
    ).expect(409);
    const replacement = await challenge(owner.accessToken);
    await googleRequest(
      replacement,
      credential(replacement, 'replacement'),
      owner.accessToken,
    ).expect(409);
    expect(
      await dataSource
        .getRepository(SocialIdentity)
        .countBy({ accountId: other.account.id }),
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(SocialIdentity)
        .findOneByOrFail({ accountId: owner.account.id }),
    ).toMatchObject({ subject: `${prefix}_exclusive` });
  });

  it.each([
    ['wrong nonce', { nonce: 'not-the-browser-nonce' }],
    ['unverified email', { email_verified: false }],
    ['missing subject', { sub: undefined }],
    ['invalid email', { email: 'invalid-email' }],
  ] as const)(
    'rejects %s and consumes the challenge on failure',
    async (_label, invalidClaims) => {
      const attempt = await challenge();
      const label = `invalid-${++serial}`;
      await googleRequest(
        attempt,
        credential(attempt, label, invalidClaims),
      ).expect(401);
      await googleRequest(attempt, credential(attempt, label)).expect(401);
      expect(verifier.verify).toHaveBeenCalledTimes(1);
      expect(
        await dataSource
          .getRepository(Account)
          .countBy({ email: email(label) }),
      ).toBe(0);
    },
  );

  it('rejects verifier errors without exposing the submitted credential', async () => {
    const attempt = await challenge();
    const sensitive = `invalid-sensitive-credential-${prefix}`;
    const response = await googleRequest(attempt, sensitive).expect(401);
    expect(response.text).not.toContain(sensitive);
    await googleRequest(attempt, credential(attempt, 'after-error')).expect(
      401,
    );
    expect(verifier.verify).toHaveBeenCalledTimes(1);
  });

  it('allows only one of two concurrent requests with the same challenge and rejects replay', async () => {
    const attempt = await challenge();
    const value = credential(attempt, 'single-use');
    const results = await Promise.all([
      googleRequest(attempt, value),
      googleRequest(attempt, value),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    expect(verifier.verify).toHaveBeenCalledTimes(1);
    await googleRequest(attempt, value).expect(401);
    expect(
      await dataSource
        .getRepository(Account)
        .countBy({ email: email('single-use') }),
    ).toBe(1);
  });

  it('concurrent first logins with different challenges create one account/identity', async () => {
    const first = await challenge();
    const second = await challenge();
    const results = await Promise.all([
      googleRequest(first, credential(first, 'race')).expect(200),
      googleRequest(second, credential(second, 'race')).expect(200),
    ]);
    expect(json<AuthResult>(results[0]).account.id).toBe(
      json<AuthResult>(results[1]).account.id,
    );
    expect(
      await dataSource.getRepository(Account).countBy({ email: email('race') }),
    ).toBe(1);
    expect(
      await dataSource
        .getRepository(SocialIdentity)
        .countBy({ subject: `${prefix}_race` }),
    ).toBe(1);
  });

  it('rejects expired, missing, malformed and duplicate browser cookies', async () => {
    const expired = await challenge();
    await dataSource
      .getRepository(GoogleAuthChallenge)
      .update(
        { tokenHash: expired.tokenHash },
        { expiresAt: new Date(Date.now() - 1_000) },
      );
    await googleRequest(expired, credential(expired, 'expired')).expect(401);
    const attempt = await challenge();
    const value = credential(attempt, 'bad-cookie');
    for (const cookie of [
      '',
      `${GOOGLE_AUTH_COOKIE}=malformed`,
      `${attempt.cookie}; ${attempt.cookie}`,
    ]) {
      await api()
        .post('/auth/google/login')
        .set(browser())
        .set('Cookie', cookie)
        .send({ credential: value })
        .expect(401);
    }
    expect(verifier.verify).not.toHaveBeenCalled();
    await googleRequest(attempt, value).expect(200);
  });

  it('requires exact origin, custom header, valid DTO and authenticated link/status endpoints', async () => {
    const before = await dataSource.getRepository(GoogleAuthChallenge).count();
    for (const headers of [
      {},
      { Origin: origin },
      { 'X-Google-Auth': '1' },
      { Origin: 'https://attacker.example', 'X-Google-Auth': '1' },
    ]) {
      await api()
        .post('/auth/google/challenge')
        .set(headers)
        .send({})
        .expect(403);
      await api()
        .post('/auth/google/login')
        .set(headers)
        .send({ credential: 'invalid' })
        .expect(403);
    }
    await api()
      .post('/auth/google/challenge')
      .set(browser())
      .send({ accountId: 1 })
      .expect(400);
    await api()
      .post('/auth/google/login')
      .set(browser())
      .send({ credential: 'a'.repeat(8193) })
      .expect(400);
    await api().post('/auth/google/login').set(browser()).send({}).expect(400);
    await api()
      .post('/auth/google/link-challenge')
      .set(browser())
      .send({})
      .expect(401);
    await api()
      .post('/auth/google/link')
      .set(browser())
      .send({ credential: 'invalid' })
      .expect(401);
    await api().get('/auth/google/status').expect(401);
    expect(await dataSource.getRepository(GoogleAuthChallenge).count()).toBe(
      before,
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('issues a Secure HttpOnly cookie for an HTTPS deployment origin', async () => {
    config.set('GOOGLE_ALLOWED_ORIGIN', 'https://game.example');
    const response = await api()
      .post('/auth/google/challenge')
      .set({ Origin: 'https://game.example', 'X-Google-Auth': '1' })
      .send({})
      .expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toContain('Secure');
    expect(cookies[0]).toContain('HttpOnly');
    const cookie = cookies[0].split(';')[0];
    challengeHashes.push(
      createHash('sha256')
        .update(cookie.slice(GOOGLE_AUTH_COOKIE.length + 1))
        .digest('hex'),
    );
  });

  afterAll(async () => {
    try {
      if (isolatedDatabaseVerified && dataSource?.isInitialized) {
        config.set('GOOGLE_CLIENT_ID', originalClientId ?? '');
        config.set('GOOGLE_ALLOWED_ORIGIN', originalOrigin ?? origin);
        if (challengeHashes.length) {
          await dataSource
            .getRepository(GoogleAuthChallenge)
            .delete({ tokenHash: In(challengeHashes) });
        }
        // Cascades remove only this suite's linked identities and career fixtures.
        await dataSource
          .getRepository(Account)
          .delete({ email: Like(`${prefix}_%`) });
      }
    } finally {
      if (app) await app.close();
    }
  });
});
