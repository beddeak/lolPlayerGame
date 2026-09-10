import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTransferAgreementDto } from './dto/create-transfer-agreement.dto';
import { FindTransferMarketQueryDto } from './dto/find-transfer-market-query.dto';
import { TransfersService } from './transfers.service';

@Controller('careers/:careerId/transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get('market')
  findMarket(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Query() query: FindTransferMarketQueryDto,
  ) {
    return this.transfers.findMarket(account.id, careerId, query);
  }

  @Get('agreements')
  findAgreements(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.transfers.findAgreements(account.id, careerId);
  }

  @Get('history')
  findHistory(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.transfers.findHistory(account.id, careerId);
  }

  @Post('agreements')
  createAgreement(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: CreateTransferAgreementDto,
  ) {
    return this.transfers.createAgreement(account.id, careerId, dto);
  }

  @Post('players/:careerPlayerId/release')
  releasePlayer(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('careerPlayerId', ParseIntPipe) careerPlayerId: number,
  ) {
    return this.transfers.releasePlayer(account.id, careerId, careerPlayerId);
  }
}
