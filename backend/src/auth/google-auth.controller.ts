import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedAccount } from './authenticated-account.interface';
import { CurrentAccount } from './current-account.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { GoogleChallengeDto, GoogleCredentialDto } from './dto/google-auth.dto';
import type {
  GoogleChallengeResponse,
  GoogleConfigResponse,
  GoogleLinkStatusResponse,
} from './dto/google-auth.dto';
import { GoogleAuthAction } from './entities/google-auth-challenge.entity';
import {
  GOOGLE_AUTH_COOKIE,
  GOOGLE_CHALLENGE_SECONDS,
  GoogleAuthService,
} from './google-auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth/google')
export class GoogleAuthController {
  constructor(private readonly googleAuth: GoogleAuthService) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  config(): GoogleConfigResponse {
    return this.googleAuth.getConfig();
  }

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  challenge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() _dto: GoogleChallengeDto,
  ): Promise<GoogleChallengeResponse> {
    void _dto; // Keep an empty DTO so the global validation pipe rejects extra fields.
    return this.issueChallenge(request, response, GoogleAuthAction.LOGIN);
  }

  @Post('link-challenge')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  linkChallenge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() _dto: GoogleChallengeDto,
  ): Promise<GoogleChallengeResponse> {
    void _dto;
    return this.issueChallenge(
      request,
      response,
      GoogleAuthAction.LINK,
      account.id,
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  login(
    @Req() request: Request,
    @Body() dto: GoogleCredentialDto,
  ): Promise<AuthResponseDto> {
    return this.googleAuth.login(request, dto.credential);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentAccount() account: AuthenticatedAccount,
  ): Promise<GoogleLinkStatusResponse> {
    return this.googleAuth.status(account.id);
  }

  @Post('link')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  link(
    @Req() request: Request,
    @Body() dto: GoogleCredentialDto,
    @CurrentAccount() account: AuthenticatedAccount,
  ): Promise<GoogleLinkStatusResponse> {
    return this.googleAuth.link(request, dto.credential, account.id);
  }

  private async issueChallenge(
    request: Request,
    response: Response,
    action: GoogleAuthAction,
    accountId: number | null = null,
  ): Promise<GoogleChallengeResponse> {
    const result = await this.googleAuth.createChallenge(
      request,
      action,
      accountId,
    );
    response.cookie(GOOGLE_AUTH_COOKIE, result.cookieValue, {
      httpOnly: true,
      secure: this.googleAuth.secureCookie(),
      sameSite: 'lax',
      path: '/',
      maxAge: GOOGLE_CHALLENGE_SECONDS * 1000,
    });
    // Do not clear on completion: an older response must not clear a newer attempt's cookie.
    // Its server-side challenge is single-use; the browser expires it after five minutes.
    return { nonce: result.nonce, expiresInSeconds: GOOGLE_CHALLENGE_SECONDS };
  }
}
