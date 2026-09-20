import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CatalogAdminGuard } from '../auth/catalog-admin.guard';
import { CreateCareerFromClubDto } from '../clubs/dto/create-career-from-club.dto';
import {
  CareerResponseDto,
  CareerSummaryResponseDto,
} from './dto/career-response.dto';
import { CreateCareerDto } from './dto/create-career.dto';
import {
  CareerMetaResponseDto,
  UpdateCareerMetaDto,
} from './dto/update-career-meta.dto';
import { CareersService } from './careers.service';

@Controller('careers')
@UseGuards(JwtAuthGuard)
export class CareersController {
  constructor(private readonly careersService: CareersService) {}

  @Post()
  @UseGuards(CatalogAdminGuard)
  create(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() dto: CreateCareerDto,
  ): Promise<CareerResponseDto> {
    return this.careersService.create(account.id, dto);
  }

  @Post('from-club')
  createFromClub(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() dto: CreateCareerFromClubDto,
  ): Promise<CareerResponseDto> {
    return this.careersService.createFromClub(account.id, dto);
  }

  @Get()
  findAll(
    @CurrentAccount() account: AuthenticatedAccount,
  ): Promise<CareerSummaryResponseDto[]> {
    return this.careersService.findAll(account.id);
  }

  @Get(':id')
  findOne(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CareerResponseDto> {
    return this.careersService.findOne(id, account.id);
  }

  @Delete(':id')
  remove(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.careersService.remove(id, account.id);
  }

  @Patch(':id/meta')
  updateMeta(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCareerMetaDto,
  ): Promise<CareerMetaResponseDto> {
    return this.careersService.updateMeta(id, account.id, dto);
  }
}
