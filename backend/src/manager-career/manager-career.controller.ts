import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentAccount } from '../auth/current-account.decorator';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ManagerCareerService } from './manager-career.service';
import { ManagerJobOffersService } from './manager-job-offers.service';

@Controller('careers/:careerId/manager')
@UseGuards(JwtAuthGuard)
export class ManagerCareerController {
  constructor(
    private readonly service: ManagerCareerService,
    private readonly jobs: ManagerJobOffersService,
  ) {}
  @Get()
  findOne(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.service.findOne(account.id, careerId);
  }

  @Get('job-offers')
  findJobOffers(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.jobs.findAll(account.id, careerId);
  }

  @Post('job-offers/check')
  checkJobOffers(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.jobs.check(account.id, careerId);
  }

  @Post('job-offers/:offerId/accept')
  acceptJobOffer(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('offerId', ParseIntPipe) offerId: number,
  ) {
    return this.jobs.respond(account.id, careerId, offerId, true);
  }

  @Post('job-offers/:offerId/decline')
  declineJobOffer(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('offerId', ParseIntPipe) offerId: number,
  ) {
    return this.jobs.respond(account.id, careerId, offerId, false);
  }
}
