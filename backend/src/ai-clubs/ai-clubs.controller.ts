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
import { AiClubsService } from './ai-clubs.service';

@Controller('careers/:careerId/ai-clubs')
@UseGuards(JwtAuthGuard)
export class AiClubsController {
  constructor(private readonly clubs: AiClubsService) {}
  @Get()
  findAll(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.clubs.findAll(account.id, careerId);
  }
}
