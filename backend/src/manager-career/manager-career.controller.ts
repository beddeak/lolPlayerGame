import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentAccount } from '../auth/current-account.decorator';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ManagerCareerService } from './manager-career.service';

@Controller('careers/:careerId/manager')
@UseGuards(JwtAuthGuard)
export class ManagerCareerController {
  constructor(private readonly service: ManagerCareerService) {}
  @Get()
  findOne(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.service.findOne(account.id, careerId);
  }
}
