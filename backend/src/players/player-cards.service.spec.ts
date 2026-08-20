import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { CreatePlayerCardDto } from './dto/create-player-card.dto';
import { PlayerCard } from './entities/player-card.entity';
import { Player } from './entities/player.entity';
import { Theme } from './entities/theme.entity';
import { Position } from './enums/position.enum';
import { PlayerCardsService } from './player-cards.service';

describe('PlayerCardsService', () => {
  const playerCardsRepository = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
  };
  const playersRepository = {
    findOneBy: jest.fn(),
  };
  const themesRepository = {
    findOneBy: jest.fn(),
  };
  const player = {
    id: 1,
    nickname: 'Test Player',
    nationality: 'KR',
    playerCards: [],
  } as Player;
  const theme = {
    id: 2,
    code: 'TEST_THEME',
    name: 'Test Theme',
    description: null,
    playerCards: [],
  } as Theme;
  const dto: CreatePlayerCardDto = {
    playerId: player.id,
    themeId: theme.id,
    cardYear: 2013,
    startingAge: 17,
    mainPosition: Position.MID,
    mechanics: 90,
    gameSense: 90,
    laning: 90,
    teamFight: 90,
    macro: 90,
    teamPlay: 90,
    mental: 90,
    championPool: 90,
    potential: 99,
  };
  const playerCard = {
    id: 3,
    ...dto,
    player,
    theme,
  };

  let service: PlayerCardsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayerCardsService,
        {
          provide: getRepositoryToken(PlayerCard),
          useValue: playerCardsRepository,
        },
        {
          provide: getRepositoryToken(Player),
          useValue: playersRepository,
        },
        {
          provide: getRepositoryToken(Theme),
          useValue: themesRepository,
        },
      ],
    }).compile();

    service = module.get<PlayerCardsService>(PlayerCardsService);
    playersRepository.findOneBy.mockResolvedValue(player);
    themesRepository.findOneBy.mockResolvedValue(theme);
    playerCardsRepository.findOneBy.mockResolvedValue(null);
    playerCardsRepository.create.mockReturnValue(playerCard);
    playerCardsRepository.save.mockResolvedValue(playerCard);
  });

  it('creates a player card without exposing potential', async () => {
    const result = await service.create(dto);

    expect(result).not.toHaveProperty('potential');
    expect(result.player).toEqual({
      id: player.id,
      nickname: player.nickname,
      nationality: player.nationality,
    });
    expect(result.theme.code).toBe(theme.code);
  });

  it('rejects a duplicate player card', async () => {
    playerCardsRepository.findOneBy.mockResolvedValue(playerCard);

    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a card for an unknown player', async () => {
    playersRepository.findOneBy.mockResolvedValue(null);

    await expect(service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters cards and keeps potential private', async () => {
    playerCardsRepository.find.mockResolvedValue([playerCard]);

    const result = await service.findAll({ cardYear: dto.cardYear });

    expect(result[0]).not.toHaveProperty('potential');
    expect(playerCardsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cardYear: dto.cardYear },
      }),
    );
  });
});
