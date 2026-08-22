import { IsInt, IsPositive, Max, Min } from 'class-validator';

const UINT32_MAX = 0xffff_ffff;

export class SimulateMatchDto {
  @IsInt()
  @IsPositive()
  careerId!: number;

  @IsInt()
  @IsPositive()
  teamAId!: number;

  @IsInt()
  @IsPositive()
  teamBId!: number;

  @IsInt()
  @Min(0)
  @Max(UINT32_MAX)
  seed!: number;
}
