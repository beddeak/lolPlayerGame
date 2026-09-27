import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CHAMPION_VARIANTS } from './variant-catalog';
import { DRAFT_TURNS, DRAFT_TURN_SECONDS } from './draft-state';
import { CHAMPIONS, CHAMPION_BALANCE_VERSION } from './champion-catalog';
import { RIOT_DATA_VERSION, RIOT_DATA_SOURCE } from './data/riot-champions';

@Controller('drafts')
@UseGuards(JwtAuthGuard)
export class DraftCatalogController {
  @Get('catalog')
  catalog() {
    return {
      version: 1,
      turnSeconds: DRAFT_TURN_SECONDS,
      turns: DRAFT_TURNS,
      variants: CHAMPION_VARIANTS,
      champions: CHAMPIONS,
      championDataVersion: RIOT_DATA_VERSION,
      championDataSource: RIOT_DATA_SOURCE,
      championBalanceVersion: CHAMPION_BALANCE_VERSION,
    };
  }
}
