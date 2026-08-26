import { Transform, TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RegisterDto {
  @Transform(({ value }: TransformFnParams) => {
    const trimmed = trim(value);

    return typeof trimmed === 'string' ? trimmed.toLowerCase() : trimmed;
  })
  @IsEmail()
  @MaxLength(191)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @Transform(({ value }: TransformFnParams) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  displayName!: string;
}
