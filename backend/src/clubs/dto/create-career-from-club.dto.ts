import { IsString, Matches, MaxLength } from 'class-validator';

export class CreateCareerFromClubDto {
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Z0-9_]+$/)
  clubCode!: string;
}
