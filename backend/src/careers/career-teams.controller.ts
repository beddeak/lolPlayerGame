import {
  Body,
  Controller,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
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

@Controller('careers/:careerId/teams')
export class CareerTeamsController {
  constructor(private readonly careerTeamsService: CareerTeamsService) {}

  @Patch(':teamId/strategy')
  updateStrategy(
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() dto: UpdateTeamStrategyDto,
  ): Promise<TeamStrategyResponseDto> {
    return this.careerTeamsService.updateStrategy(careerId, teamId, dto);
  }

  @Patch(':teamId/starters/:position/instruction')
  updatePlayerInstruction(
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('position', new ParseEnumPipe(Position)) position: Position,
    @Body() dto: UpdatePlayerInstructionDto,
  ): Promise<PlayerInstructionResponseDto> {
    return this.careerTeamsService.updatePlayerInstruction(
      careerId,
      teamId,
      position,
      dto,
    );
  }
}
