import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CatalogAdminGuard } from './catalog-admin.guard';
import { Account } from './entities/account.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { SocialIdentity } from './entities/social-identity.entity';
import { GoogleAuthChallenge } from './entities/google-auth-challenge.entity';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleAuthService } from './google-auth.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, SocialIdentity, GoogleAuthChallenge]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS'),
        },
      }),
    }),
  ],
  controllers: [AuthController, GoogleAuthController],
  providers: [
    AuthService,
    PasswordService,
    JwtAuthGuard,
    CatalogAdminGuard,
    GoogleAuthService,
    GoogleTokenVerifier,
  ],
  exports: [
    TypeOrmModule,
    JwtModule,
    JwtAuthGuard,
    CatalogAdminGuard,
    PasswordService,
  ],
})
export class AuthModule {}
