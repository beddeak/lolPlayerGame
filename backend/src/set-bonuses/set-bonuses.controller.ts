import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CreateSetBonusDto } from './dto/create-set-bonus.dto';
import { SetBonusResponseDto } from './dto/set-bonus-response.dto';
import { SetBonusesService } from './set-bonuses.service';

@Controller('set-bonuses')
export class SetBonusesController {
  constructor(private readonly setBonusesService: SetBonusesService) {}

  @Post()
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
