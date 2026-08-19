import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateThemeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
