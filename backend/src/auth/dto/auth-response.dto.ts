export class AccountResponseDto {
  id!: number;
  email!: string;
  displayName!: string;
}

export class AuthResponseDto {
  accessToken!: string;
  tokenType!: 'Bearer';
  expiresInSeconds!: number;
  account!: AccountResponseDto;
}

export class LogoutResponseDto {
  message!: string;
}
