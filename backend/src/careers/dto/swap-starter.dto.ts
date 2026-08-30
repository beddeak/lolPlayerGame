import { IsInt, IsPositive } from 'class-validator';
import { Position } from '../../players/enums/position.enum';
import { RosterRole } from '../enums/roster-role.enum';

export class SwapStarterDto {
  @IsInt()
  @IsPositive()
  benchCareerPlayerId!: number;
}

export class SwappedRosterSlotResponseDto {
  rosterId!: number;
  careerPlayerId!: number;
  role!: RosterRole;
  starterPosition!: Position | null;
}

export class SwapStarterResponseDto {
  careerId!: number;
  careerTeamId!: number;
  position!: Position;
  promotedStarter!: SwappedRosterSlotResponseDto;
  demotedBench!: SwappedRosterSlotResponseDto;
}
