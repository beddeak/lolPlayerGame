import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { CreateThemeDto } from './dto/create-theme.dto';
import { Theme } from './entities/theme.entity';
import { ThemesService } from './themes.service';

describe('ThemesService', () => {
  const themesRepository = {
    create: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
  };

  let service: ThemesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThemesService,
        {
          provide: getRepositoryToken(Theme),
          useValue: themesRepository,
        },
      ],
    }).compile();

    service = module.get<ThemesService>(ThemesService);
  });

  it('creates a theme with a nullable description', async () => {
    const dto: CreateThemeDto = {
      code: 'TEST_THEME',
      name: 'Test Theme',
    };
    const theme = {
      id: 1,
      ...dto,
      description: null,
      playerCards: [],
    } as Theme;
    themesRepository.findOneBy.mockResolvedValue(null);
    themesRepository.create.mockReturnValue(theme);
    themesRepository.save.mockResolvedValue(theme);

    await expect(service.create(dto)).resolves.toEqual(theme);
    expect(themesRepository.create).toHaveBeenCalledWith({
      ...dto,
      description: null,
    });
  });

  it('rejects a duplicate theme code', async () => {
    themesRepository.findOneBy.mockResolvedValue({ id: 1 });

    await expect(
      service.create({ code: 'TEST_THEME', name: 'Test Theme' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws when a theme does not exist', async () => {
    themesRepository.findOneBy.mockResolvedValue(null);

    await expect(service.findOne(404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
