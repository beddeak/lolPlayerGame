import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Not, IsNull, EntityManager } from 'typeorm';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { Position } from '../players/enums/position.enum';
import { isChampionArchetypeAllowed } from './config/champion-archetype.config';
import {
  PLAYER_INSTRUCTIONS_BY_POSITION,
  ROLE_PROFICIENCY_CONFIG,
} from './config/player-instruction.config';
import {
  PlayerInstructionResponseDto,
  UpdatePlayerInstructionDto,
} from './dto/update-player-instruction.dto';
import {
  TeamStrategyResponseDto,
  UpdateTeamStrategyDto,
} from './dto/update-team-strategy.dto';
import {
  ChampionArchetypeResponseDto,
  UpdateChampionArchetypeDto,
} from './dto/update-champion-archetype.dto';
import {
  SwapStarterDto,
  SwapStarterResponseDto,
  SwappedRosterSlotResponseDto,
} from './dto/swap-starter.dto';
import { CareerTeam } from './entities/career-team.entity';
import { CareerPlayerRoleProficiency } from './entities/career-player-role-proficiency.entity';
import { Roster } from './entities/roster.entity';
import { RosterRole } from './enums/roster-role.enum';
import { lockActiveManagerCareer } from '../manager-career/manager-access';

@Injectable()
export class CareerTeamsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CareerTeam)
    private readonly careerTeamsRepository: Repository<CareerTeam>,
    @InjectRepository(Roster)
    private readonly rostersRepository: Repository<Roster>,
    @InjectRepository(CareerPlayerRoleProficiency)
    private readonly roleProficienciesRepository: Repository<CareerPlayerRoleProficiency>,
  ) {}

  async updateStrategy(
    accountId: number,
    careerId: number,
    careerTeamId: number,
    dto: UpdateTeamStrategyDto,
  ): Promise<TeamStrategyResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      await lockActiveManagerCareer(manager, accountId, careerId);
      const careerTeam = await manager.getRepository(CareerTeam).findOne({
        where: {
          id: careerTeamId,
          careerId,
          isUserControlled: true,
          career: { accountId },
        },
      });

      if (!careerTeam) {
        throw new NotFoundException(
          `CareerTeam ${careerTeamId} was not found in Career ${careerId}`,
        );
      }

      await this.assertNoActiveDraft(manager, careerId, careerTeamId);
      careerTeam.teamStrategy = dto.strategy;
      const savedCareerTeam = await manager
        .getRepository(CareerTeam)
        .save(careerTeam);

      return {
        careerId,
        careerTeamId: savedCareerTeam.id,
        strategy: savedCareerTeam.teamStrategy,
      };
    });
  }

  private async assertNoActiveDraft(
    manager: EntityManager,
    careerId: number,
    careerTeamId: number,
  ) {
    const series = await manager.find(MatchSeries, {
      where: [
        { careerId, teamAId: careerTeamId, drafts: Not(IsNull()) },
        { careerId, teamBId: careerTeamId, drafts: Not(IsNull()) },
      ],
      select: {
        id: true,
        drafts: true,
        games: { id: true, seriesGameNumber: true },
      },
      relations: { games: true },
    });
    if (
      series.some((s) =>
        Object.keys(s.drafts ?? {}).some(
          (key) => !s.games.some((g) => g.seriesGameNumber === Number(key)),
        ),
      )
    ) {
      throw new ConflictException(
        '밴픽이 시작된 세트를 먼저 완료한 뒤 선발·전술을 변경해 주세요.',
      );
    }
  }

  async updatePlayerInstruction(
    accountId: number,
    careerId: number,
    careerTeamId: number,
    position: Position,
    dto: UpdatePlayerInstructionDto,
  ): Promise<PlayerInstructionResponseDto> {
    const isAllowedInstruction = PLAYER_INSTRUCTIONS_BY_POSITION[position].some(
      (instruction) => instruction === dto.instruction,
    );

    if (!isAllowedInstruction) {
      throw new BadRequestException(
        `${dto.instruction} is not valid for ${position}`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await lockActiveManagerCareer(manager, accountId, careerId);
      const roster = await manager.getRepository(Roster).findOne({
        where: {
          careerTeamId,
          role: RosterRole.STARTER,
          starterPosition: position,
        },
        relations: { careerTeam: { career: true } },
      });

      if (
        !roster ||
        !roster.careerTeam.isUserControlled ||
        roster.careerTeam.careerId !== careerId ||
        roster.careerTeam.career.accountId !== accountId
      ) {
        throw new NotFoundException(
          `${position} starter was not found in CareerTeam ${careerTeamId}`,
        );
      }

      const roleProficienciesRepository = manager.getRepository(
        CareerPlayerRoleProficiency,
      );
      let roleProficiency = await roleProficienciesRepository.findOneBy({
        careerPlayerId: roster.careerPlayerId,
        position,
        instruction: dto.instruction,
      });

      if (!roleProficiency) {
        roleProficiency = roleProficienciesRepository.create({
          careerPlayerId: roster.careerPlayerId,
          position,
          instruction: dto.instruction,
          proficiency: ROLE_PROFICIENCY_CONFIG.initial,
        });
        roleProficiency =
          await roleProficienciesRepository.save(roleProficiency);
      }

      roster.playerInstruction = dto.instruction;
      const savedRoster = await manager.getRepository(Roster).save(roster);

      return {
        careerId,
        careerTeamId,
        rosterId: savedRoster.id,
        careerPlayerId: savedRoster.careerPlayerId,
        position,
        instruction: dto.instruction,
        roleProficiency: roleProficiency.proficiency,
      };
    });
  }

  async updateChampionArchetype(
    accountId: number,
    careerId: number,
    careerTeamId: number,
    position: Position,
    dto: UpdateChampionArchetypeDto,
  ): Promise<ChampionArchetypeResponseDto> {
    if (!isChampionArchetypeAllowed(position, dto.archetype)) {
      throw new BadRequestException(
        `${dto.archetype} is not valid for ${position}`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await lockActiveManagerCareer(manager, accountId, careerId);
      const roster = await manager.getRepository(Roster).findOne({
        where: {
          careerTeamId,
          role: RosterRole.STARTER,
          starterPosition: position,
        },
        relations: { careerTeam: { career: true } },
      });

      if (
        !roster ||
        !roster.careerTeam.isUserControlled ||
        roster.careerTeam.careerId !== careerId ||
        roster.careerTeam.career.accountId !== accountId
      ) {
        throw new NotFoundException(
          `${position} starter was not found in CareerTeam ${careerTeamId}`,
        );
      }

      roster.championArchetype = dto.archetype;
      const savedRoster = await manager.getRepository(Roster).save(roster);

      return {
        careerId,
        careerTeamId,
        rosterId: savedRoster.id,
        careerPlayerId: savedRoster.careerPlayerId,
        position,
        archetype: dto.archetype,
      };
    });
  }

  async swapStarter(
    accountId: number,
    careerId: number,
    careerTeamId: number,
    position: Position,
    dto: SwapStarterDto,
  ): Promise<SwapStarterResponseDto> {
    if (
      dto.careerPlayerId !== undefined &&
      dto.benchCareerPlayerId !== undefined
    ) {
      throw new BadRequestException('Select exactly one player');
    }
    return this.dataSource.transaction(async (manager) => {
      await lockActiveManagerCareer(manager, accountId, careerId);
      const careerTeam = await manager.findOne(CareerTeam, {
        where: {
          id: careerTeamId,
          careerId,
          isUserControlled: true,
          career: { accountId },
        },
        relations: { career: true, rosters: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (!careerTeam) {
        throw new NotFoundException(
          `Managed CareerTeam ${careerTeamId} was not found in Career ${careerId}`,
        );
      }

      const currentStarter = careerTeam.rosters.find(
        (roster) =>
          roster.role === RosterRole.STARTER &&
          roster.starterPosition === position,
      );
      const selectedPlayer = careerTeam.rosters.find(
        (roster) =>
          roster.careerPlayerId ===
            (dto.careerPlayerId ?? dto.benchCareerPlayerId) &&
          (dto.careerPlayerId !== undefined ||
            roster.role === RosterRole.BENCH),
      );

      if (!selectedPlayer) {
        throw new NotFoundException(
          `CareerPlayer ${dto.careerPlayerId ?? dto.benchCareerPlayerId} was not found in CareerTeam ${careerTeamId}`,
        );
      }

      if (currentStarter?.id === selectedPlayer.id) {
        return {
          careerId,
          careerTeamId,
          position,
          promotedStarter: this.toSwappedRosterSlot(selectedPlayer),
          demotedBench: null,
          swappedStarter: null,
        };
      }
      const sourcePosition =
        selectedPlayer.role === RosterRole.STARTER
          ? selectedPlayer.starterPosition
          : null;
      await this.assertNoActiveDraft(manager, careerId, careerTeamId);
      // Vacate the unique source slot before moving its replacement. The transaction
      // keeps the temporary bench state invisible and rolls back all three writes.
      if (sourcePosition !== null) {
        selectedPlayer.role = RosterRole.BENCH;
        selectedPlayer.starterPosition = null;
        await manager.save(Roster, selectedPlayer);
      }

      let demotedBench: Roster | null = null;
      let swappedStarter: Roster | null = null;
      if (currentStarter) {
        currentStarter.role =
          sourcePosition === null ? RosterRole.BENCH : RosterRole.STARTER;
        currentStarter.starterPosition = sourcePosition;
        currentStarter.playerInstruction = null;
        currentStarter.championArchetype = null;
        const replacement = await manager.save(Roster, currentStarter);
        if (sourcePosition === null) demotedBench = replacement;
        else swappedStarter = replacement;
      }

      selectedPlayer.role = RosterRole.STARTER;
      selectedPlayer.starterPosition = position;
      selectedPlayer.playerInstruction = null;
      selectedPlayer.championArchetype = null;
      const promotedStarter = await manager.save(Roster, selectedPlayer);

      return {
        careerId,
        careerTeamId,
        position,
        promotedStarter: this.toSwappedRosterSlot(promotedStarter),
        demotedBench: demotedBench
          ? this.toSwappedRosterSlot(demotedBench)
          : null,
        swappedStarter: swappedStarter
          ? this.toSwappedRosterSlot(swappedStarter)
          : null,
      };
    });
  }

  private toSwappedRosterSlot(roster: Roster): SwappedRosterSlotResponseDto {
    return {
      rosterId: roster.id,
      careerPlayerId: roster.careerPlayerId,
      role: roster.role,
      starterPosition: roster.starterPosition,
    };
  }
}
