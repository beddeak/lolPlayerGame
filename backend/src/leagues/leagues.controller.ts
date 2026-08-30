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
import { CreateLeagueSplitDto } from './dto/create-league-split.dto';
import {
  LeagueFixtureGameResponseDto,
  LeagueSplitResponseDto,
} from './dto/league-split-response.dto';
import { LeaguesService } from './leagues.service';
import type { RegionalLeagueFormat } from './league-format.types';

@Controller('careers/:careerId/league-splits')
@UseGuards(JwtAuthGuard)
export class LeaguesController {
  constructor(private readonly leaguesService: LeaguesService) {}

  @Post()
  createSplit(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: CreateLeagueSplitDto,
  ): Promise<LeagueSplitResponseDto> {
    return this.leaguesService.createSplit(account.id, careerId, dto);
  }

  @Get()
  findAll(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ): Promise<LeagueSplitResponseDto[]> {
    return this.leaguesService.findAll(account.id, careerId);
  }

  @Get('formats')
  findFormats(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ): Promise<RegionalLeagueFormat[]> {
    return this.leaguesService.findFormats(account.id, careerId);
  }

  @Get(':splitId')
  findOne(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('splitId', ParseIntPipe) splitId: number,
  ): Promise<LeagueSplitResponseDto> {
    return this.leaguesService.findOne(account.id, careerId, splitId);
  }

  @Post(':splitId/fixtures/:fixtureId/games/simulate')
  simulateNextFixtureGame(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('splitId', ParseIntPipe) splitId: number,
    @Param('fixtureId', ParseIntPipe) fixtureId: number,
  ): Promise<LeagueFixtureGameResponseDto> {
    return this.leaguesService.simulateNextFixtureGame(
      account.id,
      careerId,
      splitId,
      fixtureId,
    );
  }
}
