import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateThemeDto } from './dto/create-theme.dto';
import { Theme } from './entities/theme.entity';
import { isDuplicateEntryError } from './utils/database-error.util';

@Injectable()
export class ThemesService {
  constructor(
    @InjectRepository(Theme)
    private readonly themesRepository: Repository<Theme>,
  ) {}

  async create(dto: CreateThemeDto): Promise<Theme> {
    const existingTheme = await this.themesRepository.findOneBy({
      code: dto.code,
    });

    if (existingTheme) {
      throw new ConflictException(`Theme code ${dto.code} already exists`);
    }

    const theme = this.themesRepository.create({
      ...dto,
      description: dto.description ?? null,
    });

    try {
      return await this.themesRepository.save(theme);
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(`Theme code ${dto.code} already exists`);
      }

      throw error;
    }
  }

  findAll(): Promise<Theme[]> {
    return this.themesRepository.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<Theme> {
    const theme = await this.themesRepository.findOneBy({ id });

    if (!theme) {
      throw new NotFoundException(`Theme ${id} was not found`);
    }

    return theme;
  }
}
