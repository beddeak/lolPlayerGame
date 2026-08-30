import { IsEnum, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Position } from '../../players/enums/position.enum';
import { PlayerInstruction } from '../enums/player-instruction.enum';
import { TeamStrategy } from '../enums/team-strategy.enum';
import {
  INDIVIDUAL_TRAINING_TYPES,
  TEAM_TRAINING_TYPES,
  TrainingType,
} from '../enums/training-type.enum';
import { TrainingCategory } from '../enums/training-category.enum';

export class CreateTeamTrainingDto {
  @IsIn(TEAM_TRAINING_TYPES)
  type!: TrainingType;

  @IsOptional()
  @IsEnum(TeamStrategy)
  strategy?: TeamStrategy;
}

export class CreateIndividualTrainingDto {
  @IsIn(INDIVIDUAL_TRAINING_TYPES)
  type!: TrainingType;

  @IsInt()
  @IsPositive()
  careerPlayerId!: number;

  @IsOptional()
  @IsEnum(Position)
  position?: Position;

  @IsOptional()
  @IsEnum(PlayerInstruction)
  instruction?: PlayerInstruction;
}

export class TrainingUsageResponseDto {
  used!: number;
  limit!: number;
  remaining!: number;
}

export class TrainingSessionResponseDto {
  id!: number;
  category!: TrainingCategory;
  type!: TrainingType;
  categorySequence!: number;
  careerTeamId!: number;
  careerPlayerId!: number | null;
  strategy!: TeamStrategy | null;
  position!: Position | null;
  instruction!: PlayerInstruction | null;
  growthSucceeded!: boolean | null;
  resultBefore!: number;
  resultDelta!: number;
  resultAfter!: number;
  conditionBefore!: number | null;
  conditionDelta!: number | null;
  conditionAfter!: number | null;
  formBefore!: number | null;
  formDelta!: number | null;
  formAfter!: number | null;
  createdAt!: Date;
}

export class TrainingPeriodResponseDto {
  id!: number;
  careerId!: number;
  periodNumber!: number;
  createdAt!: Date;
  teamTraining!: TrainingUsageResponseDto;
  individualTraining!: TrainingUsageResponseDto;
  sessions!: TrainingSessionResponseDto[];
}
