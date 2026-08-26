import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AccessTokenPayload,
  AuthenticatedRequest,
} from './authenticated-account.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [type, token] = authorization?.split(' ') ?? [];

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer access token is required');
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<AccessTokenPayload>(token);

      if (
        !Number.isInteger(payload.sub) ||
        payload.sub <= 0 ||
        typeof payload.email !== 'string'
      ) {
        throw new UnauthorizedException('Invalid access token');
      }

      request.account = {
        id: payload.sub,
        email: payload.email,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
