import { IsEnum } from 'class-validator';
import { TeamStrategy } from '../enums/team-strategy.enum';

export class UpdateCareerMetaDto {
  @IsEnum(TeamStrategy)
  meta!: TeamStrategy;
}

export class CareerMetaResponseDto {
  careerId!: number;
  currentMeta!: TeamStrategy;
}
