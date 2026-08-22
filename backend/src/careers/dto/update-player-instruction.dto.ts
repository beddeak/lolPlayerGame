import { IsEnum } from 'class-validator';
import { Position } from '../../players/enums/position.enum';
import { PlayerInstruction } from '../enums/player-instruction.enum';

export class UpdatePlayerInstructionDto {
  @IsEnum(PlayerInstruction)
  instruction!: PlayerInstruction;
}

export class PlayerInstructionResponseDto {
  careerId!: number;
  careerTeamId!: number;
  rosterId!: number;
  careerPlayerId!: number;
  position!: Position;
  instruction!: PlayerInstruction;
  roleProficiency!: number;
}
