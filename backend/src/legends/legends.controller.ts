import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LegendsService } from './legends.service';

@Controller('careers/:careerId/legend-events')
@UseGuards(JwtAuthGuard)
export class LegendsController {
  constructor(private readonly legends: LegendsService) {}

  @Get()
  findAll(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.legends.findAll(account.id, careerId);
  }
}
