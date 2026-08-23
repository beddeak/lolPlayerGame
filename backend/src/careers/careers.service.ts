import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PlayerCardResponseDto } from '../players/dto/player-card-response.dto';
import { PlayerCard } from '../players/entities/player-card.entity';
import {
  PLAYER_INSTRUCTIONS_BY_POSITION,
  ROLE_PROFICIENCY_CONFIG,
} from './config/player-instruction.config';
import { TEAM_STRATEGY_PROFICIENCY_CONFIG } from './config/team-strategy-proficiency.config';
import {
  INITIAL_CAREER_TEAM_COUNT,
  STARTER_POSITIONS,
} from './constants/career.constants';
import {
  CareerPlayerResponseDto,
  CareerResponseDto,
  CareerTeamResponseDto,
  RosterResponseDto,
} from './dto/career-response.dto';
import { CreateCareerDto } from './dto/create-career.dto';
import {
  CareerMetaResponseDto,
  UpdateCareerMetaDto,
} from './dto/update-career-meta.dto';
import { CareerPlayerRoleProficiency } from './entities/career-player-role-proficiency.entity';
import { CareerPlayer } from './entities/career-player.entity';
import { CareerTeam } from './entities/career-team.entity';
import { CareerTeamStrategyProficiency } from './entities/career-team-strategy-proficiency.entity';
import { Career } from './entities/career.entity';
import { Roster } from './entities/roster.entity';
import { RosterRole } from './enums/roster-role.enum';
import { TeamStrategy } from './enums/team-strategy.enum';

@Injectable()
export class CareersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Career)
    private readonly careersRepository: Repository<Career>,
  ) {}

  async create(dto: CreateCareerDto): Promise<CareerResponseDto> {
    this.validateCareerSetup(dto);

    const playerCardIds = dto.teams.flatMap((team) =>
      team.starters.map((starter) => starter.playerCardId),
    );

    const career = await this.dataSource.transaction(async (manager) => {
      const playerCards = await manager.find(PlayerCard, {
        where: { id: In(playerCardIds) },
        relations: { player: true, theme: true },
      });
      const playerCardsById = new Map(
        playerCards.map((playerCard) => [playerCard.id, playerCard]),
      );
      const missingPlayerCardIds = playerCardIds.filter(
        (playerCardId) => !playerCardsById.has(playerCardId),
      );

      if (missingPlayerCardIds.length > 0) {
        throw new NotFoundException(
          `PlayerCards not found: ${missingPlayerCardIds.join(', ')}`,
        );
      }

      const newCareer = manager.create(Career, {
        startYear: dto.startYear,
        currentYear: dto.startYear,
        currentMeta: TeamStrategy.BALANCED,
      });
      const savedCareer = await manager.save(Career, newCareer);

      const careerTeams = dto.teams.map((team) =>
        manager.create(CareerTeam, {
          careerId: savedCareer.id,
          career: savedCareer,
          code: team.code,
          name: team.name,
          region: team.region,
          isUserControlled: team.code === dto.managedTeamCode,
          teamStrategy: TeamStrategy.BALANCED,
        }),
      );
      const savedCareerTeams = await manager.save(CareerTeam, careerTeams);
      const strategyProficiencies = savedCareerTeams.flatMap((careerTeam) =>
        Object.values(TeamStrategy).map((strategy) =>
          manager.create(CareerTeamStrategyProficiency, {
            careerTeamId: careerTeam.id,
            careerTeam,
            strategy,
            proficiency: TEAM_STRATEGY_PROFICIENCY_CONFIG.initial,
          }),
        ),
      );
      const savedStrategyProficiencies = await manager.save(
        CareerTeamStrategyProficiency,
        strategyProficiencies,
      );

      savedCareerTeams.forEach((careerTeam) => {
        careerTeam.strategyProficiencies = savedStrategyProficiencies.filter(
          (strategyProficiency) =>
            strategyProficiency.careerTeamId === careerTeam.id,
        );
      });

      const starterSetup = dto.teams.flatMap((team, teamIndex) =>
        team.starters.map((starter) => ({
          starter,
          careerTeam: savedCareerTeams[teamIndex],
          playerCard: playerCardsById.get(starter.playerCardId)!,
        })),
      );
      const careerPlayers = starterSetup.map(
        ({ starter, careerTeam, playerCard }) =>
          manager.create(CareerPlayer, {
            careerId: savedCareer.id,
            career: savedCareer,
            playerCardId: playerCard.id,
            playerCard,
            currentTeamId: careerTeam.id,
            currentTeam: careerTeam,
            currentAge: playerCard.startingAge,
            currentPosition: starter.position,
            currentMechanics: playerCard.mechanics,
            currentGameSense: playerCard.gameSense,
            currentLaning: playerCard.laning,
            currentTeamFight: playerCard.teamFight,
            currentMacro: playerCard.macro,
            currentTeamPlay: playerCard.teamPlay,
            currentMental: playerCard.mental,
            currentChampionPool: playerCard.championPool,
          }),
      );
      const savedCareerPlayers = await manager.save(
        CareerPlayer,
        careerPlayers,
      );

      const roleProficiencies = starterSetup.flatMap(
        ({ starter }, careerPlayerIndex) =>
          PLAYER_INSTRUCTIONS_BY_POSITION[starter.position].map((instruction) =>
            manager.create(CareerPlayerRoleProficiency, {
              careerPlayerId: savedCareerPlayers[careerPlayerIndex].id,
              careerPlayer: savedCareerPlayers[careerPlayerIndex],
              position: starter.position,
              instruction,
              proficiency: ROLE_PROFICIENCY_CONFIG.initial,
            }),
          ),
      );
      const savedRoleProficiencies = await manager.save(
        CareerPlayerRoleProficiency,
        roleProficiencies,
      );

      savedCareerPlayers.forEach((careerPlayer) => {
        careerPlayer.roleProficiencies = savedRoleProficiencies.filter(
          (roleProficiency) =>
            roleProficiency.careerPlayerId === careerPlayer.id,
        );
      });

      const rosters = starterSetup.map(({ starter, careerTeam }, index) =>
        manager.create(Roster, {
          careerTeamId: careerTeam.id,
          careerTeam,
          careerPlayerId: savedCareerPlayers[index].id,
          careerPlayer: savedCareerPlayers[index],
          role: RosterRole.STARTER,
          starterPosition: starter.position,
          playerInstruction: null,
        }),
      );
      const savedRosters = await manager.save(Roster, rosters);

      savedCareerTeams.forEach((careerTeam) => {
        careerTeam.rosters = savedRosters.filter(
          (roster) => roster.careerTeamId === careerTeam.id,
        );
      });
      savedCareer.careerTeams = savedCareerTeams;

      return savedCareer;
    });

    return this.toResponse(career);
  }

  async findOne(id: number): Promise<CareerResponseDto> {
    const career = await this.careersRepository.findOne({
      where: { id },
      relations: {
        careerTeams: {
          strategyProficiencies: true,
          rosters: {
            careerPlayer: {
              roleProficiencies: true,
              playerCard: {
                player: true,
                theme: true,
              },
            },
          },
        },
      },
    });

    if (!career) {
      throw new NotFoundException(`Career ${id} was not found`);
    }

    return this.toResponse(career);
  }

  async updateMeta(
    id: number,
    dto: UpdateCareerMetaDto,
  ): Promise<CareerMetaResponseDto> {
    const career = await this.careersRepository.findOneBy({ id });

    if (!career) {
      throw new NotFoundException(`Career ${id} was not found`);
    }

    career.currentMeta = dto.meta;
    const savedCareer = await this.careersRepository.save(career);

    return {
      careerId: savedCareer.id,
      currentMeta: savedCareer.currentMeta,
    };
  }

  private validateCareerSetup(dto: CreateCareerDto): void {
    if (dto.teams.length !== INITIAL_CAREER_TEAM_COUNT) {
      throw new BadRequestException(
        `A new career must contain exactly ${INITIAL_CAREER_TEAM_COUNT} teams`,
      );
    }

    const teamCodes = dto.teams.map((team) => team.code);

    if (new Set(teamCodes).size !== teamCodes.length) {
      throw new ConflictException('Team codes must be unique within a career');
    }

    if (!teamCodes.includes(dto.managedTeamCode)) {
      throw new BadRequestException(
        `Managed team ${dto.managedTeamCode} is not part of this career`,
      );
    }

    for (const team of dto.teams) {
      const positions = team.starters.map((starter) => starter.position);
      const positionSet = new Set(positions);
      const hasEveryStarterPosition = STARTER_POSITIONS.every((position) =>
        positionSet.has(position),
      );

      if (
        positions.length !== STARTER_POSITIONS.length ||
        positionSet.size !== STARTER_POSITIONS.length ||
        !hasEveryStarterPosition
      ) {
        throw new BadRequestException(
          `Team ${team.code} must have exactly one starter for each position`,
        );
      }
    }

    const playerCardIds = dto.teams.flatMap((team) =>
      team.starters.map((starter) => starter.playerCardId),
    );

    if (new Set(playerCardIds).size !== playerCardIds.length) {
      throw new ConflictException(
        'A PlayerCard can appear only once in a career',
      );
    }
  }

  private toResponse(career: Career): CareerResponseDto {
    const positionOrder = new Map(
      STARTER_POSITIONS.map((position, index) => [position, index]),
    );
    const teams: CareerTeamResponseDto[] = [...career.careerTeams]
      .sort((left, right) => left.id - right.id)
      .map((careerTeam) => ({
        id: careerTeam.id,
        code: careerTeam.code,
        name: careerTeam.name,
        region: careerTeam.region,
        isUserControlled: careerTeam.isUserControlled,
        teamStrategy: careerTeam.teamStrategy,
        strategyProficiencies: [...(careerTeam.strategyProficiencies ?? [])]
          .sort((left, right) => left.strategy.localeCompare(right.strategy))
          .map((strategyProficiency) => ({
            strategy: strategyProficiency.strategy,
            proficiency: strategyProficiency.proficiency,
          })),
        starters: careerTeam.rosters
          .filter(
            (roster) =>
              roster.role === RosterRole.STARTER &&
              roster.starterPosition !== null,
          )
          .sort(
            (left, right) =>
              (positionOrder.get(left.starterPosition!) ?? 0) -
              (positionOrder.get(right.starterPosition!) ?? 0),
          )
          .map((roster) => this.toRosterResponse(roster)),
      }));

    return {
      id: career.id,
      startYear: career.startYear,
      currentYear: career.currentYear,
      currentMeta: career.currentMeta,
      teams,
    };
  }

  private toRosterResponse(roster: Roster): RosterResponseDto {
    return {
      id: roster.id,
      role: roster.role,
      starterPosition: roster.starterPosition,
      playerInstruction: roster.playerInstruction,
      careerPlayer: this.toCareerPlayerResponse(roster.careerPlayer),
    };
  }

  private toCareerPlayerResponse(
    careerPlayer: CareerPlayer,
  ): CareerPlayerResponseDto {
    return {
      id: careerPlayer.id,
      playerCardId: careerPlayer.playerCardId,
      currentTeamId: careerPlayer.currentTeamId,
      currentAge: careerPlayer.currentAge,
      currentPosition: careerPlayer.currentPosition,
      currentMechanics: careerPlayer.currentMechanics,
      currentGameSense: careerPlayer.currentGameSense,
      currentLaning: careerPlayer.currentLaning,
      currentTeamFight: careerPlayer.currentTeamFight,
      currentMacro: careerPlayer.currentMacro,
      currentTeamPlay: careerPlayer.currentTeamPlay,
      currentMental: careerPlayer.currentMental,
      currentChampionPool: careerPlayer.currentChampionPool,
      playerCard: this.toPlayerCardResponse(careerPlayer.playerCard),
      roleProficiencies: [...(careerPlayer.roleProficiencies ?? [])]
        .sort(
          (left, right) =>
            left.position.localeCompare(right.position) ||
            left.instruction.localeCompare(right.instruction),
        )
        .map((roleProficiency) => ({
          position: roleProficiency.position,
          instruction: roleProficiency.instruction,
          proficiency: roleProficiency.proficiency,
        })),
    };
  }

  private toPlayerCardResponse(playerCard: PlayerCard): PlayerCardResponseDto {
    return {
      id: playerCard.id,
      playerId: playerCard.playerId,
      themeId: playerCard.themeId,
      cardYear: playerCard.cardYear,
      startingAge: playerCard.startingAge,
      imageUrl: playerCard.imageUrl,
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
