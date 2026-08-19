import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePlayerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nickname!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nationality!: string;
}
