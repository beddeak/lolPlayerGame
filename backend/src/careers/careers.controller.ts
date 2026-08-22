import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CareerResponseDto } from './dto/career-response.dto';
import { CreateCareerDto } from './dto/create-career.dto';
import { CareersService } from './careers.service';

@Controller('careers')
export class CareersController {
  constructor(private readonly careersService: CareersService) {}

  @Post()
  create(@Body() dto: CreateCareerDto): Promise<CareerResponseDto> {
    return this.careersService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<CareerResponseDto> {
    return this.careersService.findOne(id);
  }
}
