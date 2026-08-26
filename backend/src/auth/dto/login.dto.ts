import { Transform, TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: TransformFnParams) => {
    const candidate = value as unknown;

    return typeof candidate === 'string'
      ? candidate.trim().toLowerCase()
      : candidate;
  })
  @IsEmail()
  @MaxLength(191)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
