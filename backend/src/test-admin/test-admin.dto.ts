import { IsObject, IsString, Matches, MaxLength } from 'class-validator';

export class EditTestPlayerDto {
  @IsObject()
  values!: Record<string, number>;

  @IsObject()
  expected!: Record<string, number>;
}

export class AdvanceTestSeasonDto {
  @Matches(/^\d{4}-11-19$/)
  targetDate!: string;

  @IsString()
  @MaxLength(80)
  cursor!: string;
}
