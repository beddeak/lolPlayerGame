import { IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleCredentialDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  credential!: string;
}

export class GoogleChallengeDto {}

export interface GoogleConfigResponse {
  enabled: boolean;
  clientId: string | null;
}

export interface GoogleChallengeResponse {
  nonce: string;
  expiresInSeconds: number;
}

export interface GoogleLinkStatusResponse {
  linked: boolean;
  email: string | null;
}
