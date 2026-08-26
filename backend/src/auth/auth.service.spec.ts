import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { Account } from './entities/account.entity';
import { PasswordService } from './password.service';

describe('AuthService', () => {
  const queryBuilder = {
    addSelect: jest.fn(),
    where: jest.fn(),
    getOne: jest.fn(),
  };
  const accountsRepository = {
    findOneBy: jest.fn(),
    create: jest.fn((value: Partial<Account>) => value as Account),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const passwordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn(),
  };

  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    queryBuilder.addSelect.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    accountsRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    accountsRepository.findOneBy.mockResolvedValue(null);
    accountsRepository.save.mockImplementation((account: Account) =>
      Promise.resolve({ ...account, id: 1 }),
    );
    passwordService.hash.mockResolvedValue('scrypt$hash');
    passwordService.verify.mockResolvedValue(true);
    jwtService.signAsync.mockResolvedValue('access-token');
    configService.getOrThrow.mockReturnValue(3600);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(Account),
          useValue: accountsRepository,
        },
        { provide: PasswordService, useValue: passwordService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('registers an account and returns a safe access-token response', async () => {
    const result = await service.register({
      email: 'coach@example.com',
      password: 'password123',
      displayName: 'Coach',
    });

    expect(passwordService.hash).toHaveBeenCalledWith('password123');
    expect(result).toEqual({
      accessToken: 'access-token',
      tokenType: 'Bearer',
      expiresInSeconds: 3600,
      account: {
        id: 1,
        email: 'coach@example.com',
        displayName: 'Coach',
      },
    });
    expect(result.account).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate email', async () => {
    accountsRepository.findOneBy.mockResolvedValue({ id: 1 });

    await expect(
      service.register({
        email: 'coach@example.com',
        password: 'password123',
        displayName: 'Coach',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in with a matching password', async () => {
    queryBuilder.getOne.mockResolvedValue({
      id: 1,
      email: 'coach@example.com',
      displayName: 'Coach',
      passwordHash: 'scrypt$hash',
    });

    const result = await service.login({
      email: 'coach@example.com',
      password: 'password123',
    });

    expect(passwordService.verify).toHaveBeenCalledWith(
      'password123',
      'scrypt$hash',
    );
    expect(result.accessToken).toBe('access-token');
  });

  it('uses the same unauthorized response for an invalid login', async () => {
    queryBuilder.getOne.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing current account', async () => {
    accountsRepository.findOneBy.mockResolvedValue(null);

    await expect(service.findMe(999)).rejects.toBeInstanceOf(NotFoundException);
  });
});
