import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedAccount,
  AuthenticatedRequest,
} from './authenticated-account.interface';

export const CurrentAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAccount =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().account,
);
