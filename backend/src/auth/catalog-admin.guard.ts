import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedRequest } from './authenticated-account.interface';
import { Account } from './entities/account.entity';

/** Catalog writes are opt-in; registering an account never grants this access. */
@Injectable()
export class CatalogAdminGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { account } = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (!account) {
      throw new UnauthorizedException('Bearer access token is required');
    }

    const adminIds = this.configService.get<number[]>(
      'CATALOG_ADMIN_ACCOUNT_IDS',
      [],
    );
    if (
      !Array.isArray(adminIds) ||
      !adminIds.includes(account.id) ||
      !(await this.accountRepository.existsBy({ id: account.id }))
    ) {
      throw new ForbiddenException('Catalog administrator access is required');
    }
    return true;
  }
}
