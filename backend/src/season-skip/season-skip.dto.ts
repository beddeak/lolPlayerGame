import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { TrainingType } from '../careers/enums/training-type.enum';

export const SKIP_STATS = [
  TrainingType.MECHANICS,
  TrainingType.GAME_SENSE,
  TrainingType.LANING,
  TrainingType.TEAM_FIGHT,
  TrainingType.MACRO,
  TrainingType.TEAM_PLAY,
  TrainingType.MENTAL,
  TrainingType.CHAMPION_POOL,
];
export class SkipIndividualDto {
  @IsInt() @IsPositive() careerPlayerId!: number;
  @IsIn(SKIP_STATS) type!: TrainingType;
}
export class SeasonSkipDto {
  @IsInt() @IsPositive() splitId!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @IsString() @MaxLength(100) cursor!: string;
  @IsEnum(TeamStrategy) strategy!: TeamStrategy;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsIn(['SCRIM', 'REST'], { each: true })
  pattern!: Array<'SCRIM' | 'REST'>;
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SkipIndividualDto)
  individuals!: SkipIndividualDto[];
}
