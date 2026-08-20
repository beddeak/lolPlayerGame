import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { CreatePlayerDto } from './dto/create-player.dto';
import { Player } from './entities/player.entity';
import { PlayersService } from './players.service';

describe('PlayersService', () => {
  const playersRepository = {
    create: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
  };

  let service: PlayersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayersService,
        {
          provide: getRepositoryToken(Player),
          useValue: playersRepository,
        },
      ],
    }).compile();

    service = module.get<PlayersService>(PlayersService);
  });

  it('creates a player identity', async () => {
    const dto: CreatePlayerDto = {
      nickname: 'Test Player',
      nationality: 'KR',
    };
    const player = { id: 1, ...dto, playerCards: [] } as Player;
    playersRepository.create.mockReturnValue(player);
    playersRepository.save.mockResolvedValue(player);

    await expect(service.create(dto)).resolves.toEqual(player);
    expect(playersRepository.create).toHaveBeenCalledWith(dto);
    expect(playersRepository.save).toHaveBeenCalledWith(player);
  });

  it('returns players in stable order', async () => {
    playersRepository.find.mockResolvedValue([]);

    await expect(service.findAll()).resolves.toEqual([]);
    expect(playersRepository.find).toHaveBeenCalledWith({
      order: { id: 'ASC' },
    });
  });

  it('throws when a player does not exist', async () => {
    playersRepository.findOneBy.mockResolvedValue(null);

    await expect(service.findOne(404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
