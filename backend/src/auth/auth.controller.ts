import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from './authenticated-account.interface';
import { AuthService } from './auth.service';
import { CurrentAccount } from './current-account.decorator';
import {
  AccountResponseDto,
  AuthResponseDto,
  LogoutResponseDto,
} from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  findMe(
    @CurrentAccount() account: AuthenticatedAccount,
  ): Promise<AccountResponseDto> {
    return this.authService.findMe(account.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(): LogoutResponseDto {
    return {
      message: 'Logged out. Remove the access token on the client.',
    };
  }
}
