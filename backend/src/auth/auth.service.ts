import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { AuthResponseDto, AccountResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Account } from './entities/account.entity';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existingAccount = await this.accountsRepository.findOneBy({
      email: dto.email,
    });

    if (existingAccount) {
      throw new ConflictException('An account with this email already exists');
    }

    const account = this.accountsRepository.create({
      email: dto.email,
      displayName: dto.displayName,
      passwordHash: await this.passwordService.hash(dto.password),
    });

    try {
      const savedAccount = await this.accountsRepository.save(account);

      return this.issueAccessToken(savedAccount);
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }

      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const account = await this.accountsRepository
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .where('account.email = :email', { email: dto.email })
      .getOne();

    if (
      !account ||
      !(await this.passwordService.verify(dto.password, account.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueAccessToken(account);
  }

  async findMe(accountId: number): Promise<AccountResponseDto> {
    const account = await this.accountsRepository.findOneBy({ id: accountId });

    if (!account) {
      throw new NotFoundException(`Account ${accountId} was not found`);
    }

    return this.toAccountResponse(account);
  }

  private async issueAccessToken(account: Account): Promise<AuthResponseDto> {
    const expiresInSeconds = this.configService.getOrThrow<number>(
      'JWT_EXPIRES_IN_SECONDS',
    );
    const accessToken = await this.jwtService.signAsync({
      sub: account.id,
      email: account.email,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds,
      account: this.toAccountResponse(account),
    };
  }

  private toAccountResponse(account: Account): AccountResponseDto {
    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
    };
  }

  private isDuplicateEntry(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { errno?: number };

    return driverError.errno === 1062;
  }
}
