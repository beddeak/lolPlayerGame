import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentAccount } from '../auth/current-account.decorator';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { TestAdminService } from './test-admin.service';
import { AdvanceTestSeasonDto, EditTestPlayerDto } from './test-admin.dto';

@Controller('careers/:careerId/test-admin')
@UseGuards(JwtAuthGuard)
export class TestAdminController {
  constructor(private readonly service: TestAdminService) {}

  @Get()
  inspect(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.service.inspect(account.id, careerId);
  }

  @Patch('players/:playerId')
  edit(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('playerId', ParseIntPipe) playerId: number,
    @Body() dto: EditTestPlayerDto,
  ) {
    return this.service.editPlayer(account.id, careerId, playerId, dto);
  }

  @Post('advance')
  advance(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: AdvanceTestSeasonDto,
  ) {
    return this.service.advance(account.id, careerId, dto);
  }
}
