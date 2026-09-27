import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const jwtService = {
    verifyAsync: jest.fn(),
  };
  const guard = new JwtAuthGuard(jwtService as unknown as JwtService);

  function createContext(authorization?: string): {
    context: ExecutionContext;
    request: { headers: { authorization?: string }; account?: unknown };
  } {
    const request = {
      headers: { authorization },
      account: undefined as unknown,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;

    return { context, request };
  }

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('accepts a valid Bearer token and attaches the account identity', async () => {
    const { context, request } = createContext('Bearer valid-token');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 7,
      email: 'coach@example.com',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.account).toEqual({
      id: 7,
      email: 'coach@example.com',
    });
  });

  async function expectInvalidSession(
    result: Promise<boolean>,
    message: string,
  ): Promise<void> {
    const error: unknown = await result.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(UnauthorizedException);
    const exception = error as UnauthorizedException;
    expect(exception.getStatus()).toBe(401);
    expect(exception.getResponse()).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      code: 'AUTH_SESSION_INVALID',
      message,
    });
  }

  it.each([undefined, 'Basic invalid-token', 'Bearer'])(
    'marks a missing Bearer token as an invalid session (%s)',
    async (authorization) => {
      const { context, request } = createContext(authorization);

      await expectInvalidSession(
        guard.canActivate(context),
        'Bearer access token is required',
      );
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(request.account).toBeUndefined();
    },
  );

  it('marks an expired access token as an invalid session', async () => {
    const tokenService = new JwtService({ secret: 'guard-unit-test-secret' });
    const expiredToken = tokenService.sign(
      { sub: 7, email: 'coach@example.com' },
      { expiresIn: -1 },
    );
    const { context, request } = createContext(`Bearer ${expiredToken}`);

    await expectInvalidSession(
      new JwtAuthGuard(tokenService).canActivate(context),
      'Invalid or expired access token',
    );
    expect(request.account).toBeUndefined();
  });

  it('marks a token verification failure as an invalid session', async () => {
    const { context, request } = createContext('Bearer invalid-token');
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expectInvalidSession(
      guard.canActivate(context),
      'Invalid or expired access token',
    );
    expect(request.account).toBeUndefined();
  });

  it.each([
    { sub: 0, email: 'coach@example.com' },
    { sub: -1, email: 'coach@example.com' },
    { sub: 1.5, email: 'coach@example.com' },
    { sub: '7', email: 'coach@example.com' },
    { sub: 7, email: null },
    null,
  ])(
    'marks an invalid account payload as an invalid session (%j)',
    async (payload) => {
      const { context, request } = createContext(
        'Bearer invalid-payload-token',
      );
      jwtService.verifyAsync.mockResolvedValue(payload);

      await expectInvalidSession(
        guard.canActivate(context),
        'Invalid or expired access token',
      );
      expect(request.account).toBeUndefined();
    },
  );
});
