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

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

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
