import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MatchSimulationResponseDto } from './dto/match-simulation-response.dto';
import { SimulateMatchDto } from './dto/simulate-match.dto';
import { MatchesService } from './matches.service';
import { TacticalRunsService } from './tactical-runs.service';

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    private readonly tacticalRunsService: TacticalRunsService,
  ) {}

  @Get(':id/tactical-run')
  tacticalRun(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tacticalRunsService.findOne(account.id, id);
  }

  @Get(':id/tactical-run/chunks/:index')
  tacticalChunk(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.tacticalRunsService.findChunk(account.id, id, index);
  }

  @Post('simulate')
  simulate(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() dto: SimulateMatchDto,
  ): Promise<MatchSimulationResponseDto> {
    return this.matchesService.simulate(account.id, dto);
  }

  @Get(':id')
  findOne(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MatchSimulationResponseDto> {
    return this.matchesService.findOne(account.id, id);
  }
}
