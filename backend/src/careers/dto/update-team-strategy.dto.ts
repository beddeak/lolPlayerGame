import { IsEnum } from 'class-validator';
import { TeamStrategy } from '../enums/team-strategy.enum';

export class UpdateTeamStrategyDto {
  @IsEnum(TeamStrategy)
  strategy!: TeamStrategy;
}

export class TeamStrategyResponseDto {
  careerId!: number;
  careerTeamId!: number;
  strategy!: TeamStrategy;
}
