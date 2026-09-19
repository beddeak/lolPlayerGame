import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentAccount } from '../auth/current-account.decorator';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { InternationalKind } from './tournament.types';
import { InternationalsService } from './internationals.service';

@Controller('careers/:careerId/internationals')
@UseGuards(JwtAuthGuard)
export class InternationalsController {
  constructor(private readonly service: InternationalsService) {}
  @Get()
  list(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.service.findAll(account.id, careerId);
  }
  @Post(':kind')
  create(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('kind', new ParseEnumPipe(InternationalKind))
    kind: InternationalKind,
  ) {
    return this.service.create(account.id, careerId, kind);
  }
  @Post(':tournamentId/roster')
  register(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('tournamentId', ParseIntPipe) tournamentId: number,
  ) {
    return this.service.registerRoster(account.id, careerId, tournamentId);
  }
  @Post(':tournamentId/fixtures/:fixtureId/simulate')
  simulate(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('tournamentId', ParseIntPipe) tournamentId: number,
    @Param('fixtureId', ParseIntPipe) fixtureId: number,
  ) {
    return this.service.simulate(account.id, careerId, tournamentId, fixtureId);
  }
}
