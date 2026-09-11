import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CatalogAdminGuard } from '../auth/catalog-admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSetBonusDto } from './dto/create-set-bonus.dto';
import { SetBonusResponseDto } from './dto/set-bonus-response.dto';
import { SetBonusesService } from './set-bonuses.service';

@Controller('set-bonuses')
export class SetBonusesController {
  constructor(private readonly setBonusesService: SetBonusesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, CatalogAdminGuard)
  create(@Body() dto: CreateSetBonusDto): Promise<SetBonusResponseDto> {
    return this.setBonusesService.create(dto);
  }

  @Get()
  findAll(): Promise<SetBonusResponseDto[]> {
    return this.setBonusesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<SetBonusResponseDto> {
    return this.setBonusesService.findOne(id);
  }
}
