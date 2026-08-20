import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CreateThemeDto } from './dto/create-theme.dto';
import { Theme } from './entities/theme.entity';
import { ThemesService } from './themes.service';

@Controller('themes')
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  @Post()
  create(@Body() dto: CreateThemeDto): Promise<Theme> {
    return this.themesService.create(dto);
  }

  @Get()
  findAll(): Promise<Theme[]> {
    return this.themesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Theme> {
    return this.themesService.findOne(id);
  }
}
