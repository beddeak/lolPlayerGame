import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PlayerCard } from '../players/entities/player-card.entity';
import { isDuplicateEntryError } from '../players/utils/database-error.util';
import { CreateSetBonusDto } from './dto/create-set-bonus.dto';
import { SetBonusResponseDto } from './dto/set-bonus-response.dto';
import { SetBonusRequirement } from './entities/set-bonus-requirement.entity';
import { SetBonus } from './entities/set-bonus.entity';
import { toSetBonusResponse } from './set-bonus.utils';

@Injectable()
export class SetBonusesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SetBonus)
    private readonly setBonusesRepository: Repository<SetBonus>,
    @InjectRepository(PlayerCard)
    private readonly playerCardsRepository: Repository<PlayerCard>,
  ) {}

  async create(dto: CreateSetBonusDto): Promise<SetBonusResponseDto> {
    const existingSetBonus = await this.setBonusesRepository.findOneBy({
      code: dto.code,
    });

    if (existingSetBonus) {
      throw new ConflictException(`SetBonus code ${dto.code} already exists`);
    }

    const playerCards = await this.playerCardsRepository.findBy({
      id: In(dto.requiredPlayerCardIds),
    });
    const foundPlayerCardIds = new Set(playerCards.map((card) => card.id));
    const missingPlayerCardIds = dto.requiredPlayerCardIds.filter(
      (id) => !foundPlayerCardIds.has(id),
    );

    if (missingPlayerCardIds.length > 0) {
      throw new NotFoundException(
        `PlayerCards not found: ${missingPlayerCardIds.join(', ')}`,
      );
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const setBonus = manager.create(SetBonus, {
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          chemistryBonus: dto.chemistryBonus ?? 0,
          laningBonus: dto.laningBonus ?? 0,
          teamFightBonus: dto.teamFightBonus ?? 0,
          macroBonus: dto.macroBonus ?? 0,
          teamPlayBonus: dto.teamPlayBonus ?? 0,
        });
        const savedSetBonus = await manager.save(SetBonus, setBonus);
        const requirements = dto.requiredPlayerCardIds.map((playerCardId) =>
          manager.create(SetBonusRequirement, {
            setBonusId: savedSetBonus.id,
            setBonus: savedSetBonus,
            playerCardId,
          }),
        );

        savedSetBonus.requirements = await manager.save(
          SetBonusRequirement,
          requirements,
        );

        return toSetBonusResponse(savedSetBonus);
      });
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(`SetBonus code ${dto.code} already exists`);
      }

      throw error;
    }
  }

  async findAll(): Promise<SetBonusResponseDto[]> {
    const setBonuses = await this.setBonusesRepository.find({
      relations: { requirements: true },
      order: { id: 'ASC' },
    });

    return setBonuses.map((setBonus) => toSetBonusResponse(setBonus));
  }

  async findOne(id: number): Promise<SetBonusResponseDto> {
    const setBonus = await this.setBonusesRepository.findOne({
      where: { id },
      relations: { requirements: true },
    });

    if (!setBonus) {
      throw new NotFoundException(`SetBonus ${id} was not found`);
    }

    return toSetBonusResponse(setBonus);
  }
}
