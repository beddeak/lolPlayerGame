import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position } from '../players/enums/position.enum';
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
import { CareerTeam } from './entities/career-team.entity';
import { CareerPlayerRoleProficiency } from './entities/career-player-role-proficiency.entity';
import { Roster } from './entities/roster.entity';
import { RosterRole } from './enums/roster-role.enum';

@Injectable()
export class CareerTeamsService {
  constructor(
    @InjectRepository(CareerTeam)
    private readonly careerTeamsRepository: Repository<CareerTeam>,
    @InjectRepository(Roster)
    private readonly rostersRepository: Repository<Roster>,
    @InjectRepository(CareerPlayerRoleProficiency)
    private readonly roleProficienciesRepository: Repository<CareerPlayerRoleProficiency>,
  ) {}

  async updateStrategy(
    careerId: number,
    careerTeamId: number,
    dto: UpdateTeamStrategyDto,
  ): Promise<TeamStrategyResponseDto> {
    const careerTeam = await this.careerTeamsRepository.findOneBy({
      id: careerTeamId,
      careerId,
    });

    if (!careerTeam) {
      throw new NotFoundException(
        `CareerTeam ${careerTeamId} was not found in Career ${careerId}`,
      );
    }

    careerTeam.teamStrategy = dto.strategy;
    const savedCareerTeam = await this.careerTeamsRepository.save(careerTeam);

    return {
      careerId,
      careerTeamId: savedCareerTeam.id,
      strategy: savedCareerTeam.teamStrategy,
    };
  }

  async updatePlayerInstruction(
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

    const roster = await this.rostersRepository.findOne({
      where: {
        careerTeamId,
        role: RosterRole.STARTER,
        starterPosition: position,
      },
      relations: { careerTeam: true },
    });

    if (!roster || roster.careerTeam.careerId !== careerId) {
      throw new NotFoundException(
        `${position} starter was not found in CareerTeam ${careerTeamId}`,
      );
    }

    let roleProficiency = await this.roleProficienciesRepository.findOneBy({
      careerPlayerId: roster.careerPlayerId,
      position,
      instruction: dto.instruction,
    });

    if (!roleProficiency) {
      roleProficiency = this.roleProficienciesRepository.create({
        careerPlayerId: roster.careerPlayerId,
        position,
        instruction: dto.instruction,
        proficiency: ROLE_PROFICIENCY_CONFIG.initial,
      });
      roleProficiency =
        await this.roleProficienciesRepository.save(roleProficiency);
    }

    roster.playerInstruction = dto.instruction;
    const savedRoster = await this.rostersRepository.save(roster);

    return {
      careerId,
      careerTeamId,
      rosterId: savedRoster.id,
      careerPlayerId: savedRoster.careerPlayerId,
      position,
      instruction: dto.instruction,
      roleProficiency: roleProficiency.proficiency,
    };
  }
}
