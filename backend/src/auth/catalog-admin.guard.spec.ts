import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Account } from './entities/account.entity';
import { CatalogAdminGuard } from './catalog-admin.guard';

describe('CatalogAdminGuard', () => {
  const config = new ConfigService();
  const accounts = { existsBy: jest.fn() };
  const guard = new CatalogAdminGuard(
    config,
    accounts as unknown as Repository<Account>,
  );
  const context = (id?: number) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ account: id ? { id } : undefined }),
      }),
    }) as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    config.set('CATALOG_ADMIN_ACCOUNT_IDS', []);
    accounts.existsBy.mockResolvedValue(true);
  });

  it('requires an authenticated account', async () => {
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(accounts.existsBy).not.toHaveBeenCalled();
  });

  it('denies registered users by default and non-admins after configuration', async () => {
    await expect(guard.canActivate(context(7))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    config.set('CATALOG_ADMIN_ACCOUNT_IDS', [12]);
    await expect(guard.canActivate(context(7))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(accounts.existsBy).not.toHaveBeenCalled();
  });

  it('permits an explicitly configured, existing account and observes revocation', async () => {
    config.set('CATALOG_ADMIN_ACCOUNT_IDS', [7]);
    await expect(guard.canActivate(context(7))).resolves.toBe(true);
    expect(accounts.existsBy).toHaveBeenCalledWith({ id: 7 });
    config.set('CATALOG_ADMIN_ACCOUNT_IDS', []);
    await expect(guard.canActivate(context(7))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not accept a deleted admin account or raw unvalidated configuration', async () => {
    config.set('CATALOG_ADMIN_ACCOUNT_IDS', [7]);
    accounts.existsBy.mockResolvedValue(false);
    await expect(guard.canActivate(context(7))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    config.set('CATALOG_ADMIN_ACCOUNT_IDS', '7');
    await expect(guard.canActivate(context(7))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
