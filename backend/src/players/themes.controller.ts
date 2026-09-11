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
import { CreateThemeDto } from './dto/create-theme.dto';
import { Theme } from './entities/theme.entity';
import { ThemesService } from './themes.service';

@Controller('themes')
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, CatalogAdminGuard)
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
