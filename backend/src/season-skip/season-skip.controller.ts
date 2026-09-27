import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentAccount } from '../auth/current-account.decorator';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { SeasonSkipService } from './season-skip.service';
import { SeasonSkipDto } from './season-skip.dto';
@Controller('careers/:careerId/season-skip')
@UseGuards(JwtAuthGuard)
export class SeasonSkipController {
  constructor(private readonly service: SeasonSkipService) {}
  @Get() inspect(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) id: number,
  ) {
    return this.service.inspect(account.id, id);
  }
  @Post('step') step(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) id: number,
    @Body() dto: SeasonSkipDto,
  ) {
    return this.service.step(account.id, id, dto);
  }
}
