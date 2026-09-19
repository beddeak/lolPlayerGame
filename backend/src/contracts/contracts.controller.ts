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
import { ContractsService } from './contracts.service';
import { CreateContractOfferDto } from './dto/create-contract-offer.dto';
import { RespondContractOfferDto } from './dto/respond-contract-offer.dto';
import { CreatePlayerSaleDto } from './dto/create-player-sale.dto';

@Controller('careers/:careerId/contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  findContracts(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.contracts.findContracts(account.id, careerId);
  }

  @Get('offers')
  findOffers(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.contracts.findOffers(account.id, careerId);
  }

  @Post('offers')
  createOffer(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: CreateContractOfferDto,
  ) {
    return this.contracts.createOffer(account.id, careerId, dto);
  }

  @Get('sales')
  findSales(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
  ) {
    return this.contracts.findSales(account.id, careerId);
  }

  @Post('sales')
  createSale(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: CreatePlayerSaleDto,
  ) {
    return this.contracts.createSale(account.id, careerId, dto);
  }

  @Post('sales/:offerId/cancel')
  cancelSale(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('offerId', ParseIntPipe) offerId: number,
  ) {
    return this.contracts.cancelSale(account.id, careerId, offerId);
  }

  @Post('offers/:offerId/respond')
  respond(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Param('offerId', ParseIntPipe) offerId: number,
    @Body() dto: RespondContractOfferDto,
  ) {
    return this.contracts.respond(account.id, careerId, offerId, dto);
  }
}
