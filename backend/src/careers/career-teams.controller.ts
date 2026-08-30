import {
  Body,
  Controller,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Position } from '../players/enums/position.enum';
import { CareerTeamsService } from './career-teams.service';
import {
  PlayerInstructionResponseDto,
  UpdatePlayerInstructionDto,
} from './dto/update-player-instruction.dto';
import {
  TeamStrategyResponseDto,
  UpdateTeamStrategyDto,
} from './dto/update-team-strategy.dto';
import {
  ChampionArchetypeResponseDto,
  UpdateChampionArchetypeDto,
} from './dto/update-champion-archetype.dto';
import { SwapStarterDto, SwapStarterResponseDto } from './dto/swap-starter.dto';

@Controller('careers/:careerId/teams')
@UseGuards(JwtAuthGuard)
export class CareerTeamsController {
  constructor(private readonly careerTeamsService: CareerTeamsService) {}

  @Patch(':teamId/strategy')
  updateStrategy(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() dto: UpdateTeamStrategyDto,
  ): Promise<TeamStrategyResponseDto> {
    return this.careerTeamsService.updateStrategy(
      account.id,
      careerId,
      teamId,
      dto,
    );
  }

  @Patch(':teamId/starters/:position/instruction')
  updatePlayerInstruction(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('position', new ParseEnumPipe(Position)) position: Position,
    @Body() dto: UpdatePlayerInstructionDto,
  ): Promise<PlayerInstructionResponseDto> {
    return this.careerTeamsService.updatePlayerInstruction(
      account.id,
      careerId,
      teamId,
      position,
      dto,
    );
  }

  @Patch(':teamId/starters/:position/archetype')
  updateChampionArchetype(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('position', new ParseEnumPipe(Position)) position: Position,
    @Body() dto: UpdateChampionArchetypeDto,
  ): Promise<ChampionArchetypeResponseDto> {
    return this.careerTeamsService.updateChampionArchetype(
      account.id,
      careerId,
      teamId,
      position,
      dto,
    );
  }

  @Patch(':teamId/starters/:position/swap')
  swapStarter(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('position', new ParseEnumPipe(Position)) position: Position,
    @Body() dto: SwapStarterDto,
  ): Promise<SwapStarterResponseDto> {
    return this.careerTeamsService.swapStarter(
      account.id,
      careerId,
      teamId,
      position,
      dto,
    );
  }
}
