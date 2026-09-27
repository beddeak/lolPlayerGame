import { IsInt, IsPositive, ValidateIf } from 'class-validator';
import { Position } from '../../players/enums/position.enum';
import { RosterRole } from '../enums/roster-role.enum';

export class SwapStarterDto {
  // Retained for older clients that only promote bench players.
  @ValidateIf(
    (dto: SwapStarterDto) =>
      dto.benchCareerPlayerId !== undefined || dto.careerPlayerId === undefined,
  )
  @IsInt()
  @IsPositive()
  benchCareerPlayerId?: number;

  @ValidateIf((dto: SwapStarterDto) => dto.careerPlayerId !== undefined)
  @IsInt()
  @IsPositive()
  careerPlayerId?: number;
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
  demotedBench!: SwappedRosterSlotResponseDto | null;
  swappedStarter?: SwappedRosterSlotResponseDto | null;
}
