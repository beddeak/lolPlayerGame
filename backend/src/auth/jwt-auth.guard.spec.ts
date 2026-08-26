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
    jest.clearAllMocks();
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

  it('rejects a request without a Bearer token', async () => {
    const { context } = createContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
