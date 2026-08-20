import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { CreatePlayerCardDto } from './dto/create-player-card.dto';
import { PlayerCardResponseDto } from './dto/player-card-response.dto';
import { QueryPlayerCardDto } from './dto/query-player-card.dto';
import { PlayerCard } from './entities/player-card.entity';
import { Player } from './entities/player.entity';
import { Theme } from './entities/theme.entity';
import { isDuplicateEntryError } from './utils/database-error.util';

@Injectable()
export class PlayerCardsService {
  constructor(
    @InjectRepository(PlayerCard)
    private readonly playerCardsRepository: Repository<PlayerCard>,
    @InjectRepository(Player)
    private readonly playersRepository: Repository<Player>,
    @InjectRepository(Theme)
    private readonly themesRepository: Repository<Theme>,
  ) {}

  async create(dto: CreatePlayerCardDto): Promise<PlayerCardResponseDto> {
    const [player, theme] = await Promise.all([
      this.playersRepository.findOneBy({ id: dto.playerId }),
      this.themesRepository.findOneBy({ id: dto.themeId }),
    ]);

    if (!player) {
      throw new NotFoundException(`Player ${dto.playerId} was not found`);
    }

    if (!theme) {
      throw new NotFoundException(`Theme ${dto.themeId} was not found`);
    }

    const existingCard = await this.playerCardsRepository.findOneBy({
      playerId: dto.playerId,
      themeId: dto.themeId,
      cardYear: dto.cardYear,
    });

    if (existingCard) {
      throw this.createDuplicateCardException(dto);
    }

    const playerCard = this.playerCardsRepository.create({
      ...dto,
      player,
      theme,
    });

    try {
      const savedPlayerCard = await this.playerCardsRepository.save(playerCard);

      return this.toResponse(savedPlayerCard);
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw this.createDuplicateCardException(dto);
      }

      throw error;
    }
  }

  async findAll(query: QueryPlayerCardDto): Promise<PlayerCardResponseDto[]> {
    const where: FindOptionsWhere<PlayerCard> = {};

    if (query.playerId !== undefined) {
      where.playerId = query.playerId;
    }

    if (query.themeId !== undefined) {
      where.themeId = query.themeId;
    }

    if (query.cardYear !== undefined) {
      where.cardYear = query.cardYear;
    }

    const playerCards = await this.playerCardsRepository.find({
      where,
      relations: {
        player: true,
        theme: true,
      },
      order: {
        cardYear: 'ASC',
        id: 'ASC',
      },
    });

    return playerCards.map((playerCard) => this.toResponse(playerCard));
  }

  async findOne(id: number): Promise<PlayerCardResponseDto> {
    const playerCard = await this.playerCardsRepository.findOne({
      where: { id },
      relations: {
        player: true,
        theme: true,
      },
    });

    if (!playerCard) {
      throw new NotFoundException(`PlayerCard ${id} was not found`);
    }

    return this.toResponse(playerCard);
  }

  private createDuplicateCardException(
    dto: CreatePlayerCardDto,
  ): ConflictException {
    return new ConflictException(
      `PlayerCard for player ${dto.playerId}, theme ${dto.themeId}, and year ${dto.cardYear} already exists`,
    );
  }

  private toResponse(playerCard: PlayerCard): PlayerCardResponseDto {
    return {
      id: playerCard.id,
      playerId: playerCard.playerId,
      themeId: playerCard.themeId,
      cardYear: playerCard.cardYear,
      startingAge: playerCard.startingAge,
      mainPosition: playerCard.mainPosition,
      mechanics: playerCard.mechanics,
      gameSense: playerCard.gameSense,
      laning: playerCard.laning,
      teamFight: playerCard.teamFight,
      macro: playerCard.macro,
      teamPlay: playerCard.teamPlay,
      mental: playerCard.mental,
      championPool: playerCard.championPool,
      player: {
        id: playerCard.player.id,
        nickname: playerCard.player.nickname,
        nationality: playerCard.player.nationality,
      },
      theme: {
        id: playerCard.theme.id,
        code: playerCard.theme.code,
        name: playerCard.theme.name,
        description: playerCard.theme.description,
      },
    };
  }
}
