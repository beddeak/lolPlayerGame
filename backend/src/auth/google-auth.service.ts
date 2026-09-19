import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import {
  DataSource,
  EntityManager,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  QueryFailedError,
} from 'typeorm';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import {
  GoogleConfigResponse,
  GoogleLinkStatusResponse,
} from './dto/google-auth.dto';
import { Account } from './entities/account.entity';
import {
  GoogleAuthAction,
  GoogleAuthChallenge,
} from './entities/google-auth-challenge.entity';
import {
  SocialIdentity,
  SocialProvider,
} from './entities/social-identity.entity';
import { GoogleTokenVerifier } from './google-token-verifier.service';

export const GOOGLE_AUTH_COOKIE = 'lol_google_auth';
export const GOOGLE_CHALLENGE_SECONDS = 300;
const INVALID_CHALLENGE =
  '구글 로그인 요청이 만료되었거나 이미 사용되었습니다. 다시 시도해주세요.';
const EMAIL_COLLISION = '이 이메일로 로그인한 뒤 구글 계정을 연결해주세요.';
const LINK_CONFLICT =
  '이미 다른 계정에 연결되었거나 다른 구글 계정이 연결되어 있습니다.';

interface VerifiedIdentity {
  subject: string;
  email: string;
  displayName: string;
}

@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly verifier: GoogleTokenVerifier,
    private readonly auth: AuthService,
  ) {}

  getConfig(): GoogleConfigResponse {
    const clientId =
      this.config.get<string>('GOOGLE_CLIENT_ID')?.trim() || null;
    return { enabled: Boolean(clientId), clientId };
  }

  secureCookie(): boolean {
    return (
      this.config
        .get<string>('GOOGLE_ALLOWED_ORIGIN')
        ?.startsWith('https://') ?? false
    );
  }

  assertBrowserRequest(request: Pick<Request, 'headers'>): string {
    const { clientId } = this.getConfig();
    const allowedOrigin = this.config.get<string>('GOOGLE_ALLOWED_ORIGIN');
    if (!clientId || !allowedOrigin) {
      throw new ServiceUnavailableException(
        '구글 로그인이 아직 설정되지 않았습니다.',
      );
    }
    if (
      request.headers.origin !== allowedOrigin ||
      request.headers['x-google-auth'] !== '1'
    ) {
      throw new ForbiddenException('허용되지 않은 구글 로그인 요청입니다.');
    }
    return clientId;
  }

  async createChallenge(
    request: Pick<Request, 'headers'>,
    action: GoogleAuthAction,
    accountId: number | null = null,
  ): Promise<{ nonce: string; cookieValue: string }> {
    this.assertBrowserRequest(request);
    if (action === GoogleAuthAction.LINK) {
      await this.requireAccount(this.dataSource.manager, accountId);
    }
    const repository = this.dataSource.getRepository(GoogleAuthChallenge);
    // Only ephemeral, expired challenges are removed; accounts/saves are untouched.
    await repository.delete({ expiresAt: LessThanOrEqual(new Date()) });
    const cookieValue = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    await repository.save(
      repository.create({
        tokenHash: this.hash(cookieValue),
        nonceHash: this.hash(nonce),
        action,
        accountId: action === GoogleAuthAction.LINK ? accountId : null,
        expiresAt: new Date(Date.now() + GOOGLE_CHALLENGE_SECONDS * 1000),
      }),
    );
    return { nonce, cookieValue };
  }

  async login(
    request: Pick<Request, 'headers'>,
    credential: string,
  ): Promise<AuthResponseDto> {
    const identity = await this.verifyChallenge(
      request,
      credential,
      GoogleAuthAction.LOGIN,
      null,
    );
    let account: Account;
    try {
      account = await this.dataSource.transaction(async (manager) => {
        const linked = await this.findIdentity(manager, identity.subject);
        if (linked) {
          await manager.update(SocialIdentity, linked.id, {
            email: identity.email,
          });
          return linked.account;
        }
        if (await manager.existsBy(Account, { email: identity.email })) {
          throw new ConflictException(EMAIL_COLLISION);
        }
        const created = await manager.save(
          Account,
          manager.create(Account, {
            email: identity.email,
            displayName: identity.displayName,
            passwordHash: null,
          }),
        );
        await manager.save(
          SocialIdentity,
          manager.create(SocialIdentity, {
            provider: SocialProvider.GOOGLE,
            subject: identity.subject,
            accountId: created.id,
            email: identity.email,
          }),
        );
        return created;
      });
    } catch (error) {
      if (!this.isDuplicateEntry(error)) throw error;
      // A concurrent first login may have just created this same stable identity.
      const linked = await this.findIdentity(
        this.dataSource.manager,
        identity.subject,
      );
      if (!linked) throw new ConflictException(EMAIL_COLLISION);
      account = linked.account;
    }
    return this.auth.issueAccessToken(account);
  }

  async status(accountId: number): Promise<GoogleLinkStatusResponse> {
    await this.requireAccount(this.dataSource.manager, accountId);
    const identity = await this.dataSource
      .getRepository(SocialIdentity)
      .findOneBy({
        accountId,
        provider: SocialProvider.GOOGLE,
      });
    return { linked: Boolean(identity), email: identity?.email ?? null };
  }

  async link(
    request: Pick<Request, 'headers'>,
    credential: string,
    accountId: number,
  ): Promise<GoogleLinkStatusResponse> {
    const identity = await this.verifyChallenge(
      request,
      credential,
      GoogleAuthAction.LINK,
      accountId,
    );
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.requireAccount(manager, accountId);
        const existing = await this.findIdentity(manager, identity.subject);
        if (existing) {
          if (existing.accountId !== accountId)
            throw new ConflictException(LINK_CONFLICT);
          await manager.update(SocialIdentity, existing.id, {
            email: identity.email,
          });
          return;
        }
        if (
          await manager.existsBy(SocialIdentity, {
            accountId,
            provider: SocialProvider.GOOGLE,
          })
        ) {
          throw new ConflictException(LINK_CONFLICT);
        }
        await manager.save(
          SocialIdentity,
          manager.create(SocialIdentity, {
            provider: SocialProvider.GOOGLE,
            subject: identity.subject,
            accountId,
            email: identity.email,
          }),
        );
      });
    } catch (error) {
      if (!this.isDuplicateEntry(error)) throw error;
      const existing = await this.findIdentity(
        this.dataSource.manager,
        identity.subject,
      );
      if (existing?.accountId !== accountId)
        throw new ConflictException(LINK_CONFLICT);
    }
    return { linked: true, email: identity.email };
  }

  private async verifyChallenge(
    request: Pick<Request, 'headers'>,
    credential: string,
    action: GoogleAuthAction,
    accountId: number | null,
  ): Promise<VerifiedIdentity> {
    const audience = this.assertBrowserRequest(request);
    const tokenHash = this.hash(this.readCookie(request.headers.cookie));
    const repository = this.dataSource.getRepository(GoogleAuthChallenge);
    const criteria = {
      tokenHash,
      action,
      accountId: accountId ?? IsNull(),
      expiresAt: MoreThan(new Date()),
    };
    const challenge = await repository.findOneBy(criteria);
    if (!challenge) throw new UnauthorizedException(INVALID_CHALLENGE);
    // Atomic affected-row check guarantees one use across processes and concurrent requests.
    // Consume even on failed token verification. A retry must request a fresh nonce.
    const consumed = await repository.delete({
      ...criteria,
      expiresAt: MoreThan(new Date()),
    });
    if (consumed.affected !== 1)
      throw new UnauthorizedException(INVALID_CHALLENGE);
    const payload = await this.verifier.verify(credential, audience);
    if (
      typeof payload.nonce !== 'string' ||
      !timingSafeEqual(
        Buffer.from(this.hash(payload.nonce), 'hex'),
        Buffer.from(challenge.nonceHash, 'hex'),
      ) ||
      typeof payload.sub !== 'string' ||
      !payload.sub.trim() ||
      payload.sub.length > 255 ||
      payload.sub !== payload.sub.trim() ||
      payload.email_verified !== true ||
      typeof payload.email !== 'string' ||
      payload.email.length > 191 ||
      !isEmail(payload.email)
    ) {
      throw new UnauthorizedException(
        '구글 계정 정보를 확인할 수 없습니다. 다시 로그인해주세요.',
      );
    }
    const name =
      typeof payload.name === 'string'
        ? payload.name
            // eslint-disable-next-line no-control-regex -- Remove control characters from provider display names.
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, 50)
            .replace(/[\ud800-\udbff]$/, '')
        : '';
    return {
      subject: payload.sub,
      email: payload.email.toLowerCase(),
      displayName: name || '감독',
    };
  }

  private readCookie(header: string | undefined): string {
    const values = (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.split('=', 1)[0] === GOOGLE_AUTH_COOKIE);
    if (values.length !== 1) throw new UnauthorizedException(INVALID_CHALLENGE);
    const value = values[0].slice(GOOGLE_AUTH_COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new UnauthorizedException(INVALID_CHALLENGE);
    return value;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private findIdentity(
    manager: EntityManager,
    subject: string,
  ): Promise<SocialIdentity | null> {
    return manager.findOne(SocialIdentity, {
      where: { provider: SocialProvider.GOOGLE, subject },
      relations: { account: true },
    });
  }

  private async requireAccount(
    manager: EntityManager,
    accountId: number | null,
  ): Promise<void> {
    if (
      accountId === null ||
      !(await manager.existsBy(Account, { id: accountId }))
    ) {
      throw new UnauthorizedException(
        '로그인한 계정을 확인할 수 없습니다. 다시 로그인해주세요.',
      );
    }
  }

  private isDuplicateEntry(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { errno?: number }).errno === 1062
    );
  }
}
