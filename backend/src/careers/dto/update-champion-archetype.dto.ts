import { IsEnum } from 'class-validator';
import { Position } from '../../players/enums/position.enum';
import { ChampionArchetype } from '../enums/champion-archetype.enum';

export class UpdateChampionArchetypeDto {
  @IsEnum(ChampionArchetype)
  archetype!: ChampionArchetype;
}

export class ChampionArchetypeResponseDto {
  careerId!: number;
  careerTeamId!: number;
  rosterId!: number;
  careerPlayerId!: number;
  position!: Position;
  archetype!: ChampionArchetype;
}
