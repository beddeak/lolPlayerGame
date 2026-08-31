import { IsInt, IsPositive } from 'class-validator';

export class QuickSimDto {
  @IsInt()
  @IsPositive()
  leagueSplitId!: number;

  @IsInt()
  @IsPositive()
  fixtureId!: number;
}
