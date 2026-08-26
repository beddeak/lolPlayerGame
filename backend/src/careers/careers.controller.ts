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
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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
  create(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() dto: CreateCareerDto,
  ): Promise<CareerResponseDto> {
    return this.careersService.create(account.id, dto);
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

  @Patch(':id/meta')
  updateMeta(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCareerMetaDto,
  ): Promise<CareerMetaResponseDto> {
    return this.careersService.updateMeta(id, account.id, dto);
  }
}
