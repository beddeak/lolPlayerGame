import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Region } from '../careers/enums/region.enum';
import { getLeagueFixtureDate } from '../calendars/config/season-calendar.config';
import { EventQueueService } from '../event-queue/event-queue.service';
import { getSeriesWinsRequired } from '../match-series/config/bo3-series.config';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { MatchSeriesStatus } from '../match-series/enums/match-series-status.enum';
import { MatchSeriesService } from '../match-series/match-series.service';
import {
  getRegionalLeagueFormat,
  REGIONAL_LEAGUE_FORMATS,
} from './config/regional-league-formats';
import { LEAGUE_CONFIG } from './config/league.config';
import { CreateLeagueSplitDto } from './dto/create-league-split.dto';
import {
  LeagueFixtureGameResponseDto,
  LeagueFixtureResponseDto,
  LeagueFixtureTeamResponseDto,
  LeagueSplitResponseDto,
  LeagueStageParticipantResponseDto,
  LeagueStageResponseDto,
  LeagueStandingResponseDto,
} from './dto/league-split-response.dto';
import { LeagueFixture } from './entities/league-fixture.entity';
import { LeagueSplit } from './entities/league-split.entity';
import { LeagueStageParticipant } from './entities/league-stage-participant.entity';
import { LeagueStage } from './entities/league-stage.entity';
import { LeagueFixtureStatus } from './enums/league-fixture-status.enum';
import { LeagueSplitStatus } from './enums/league-split-status.enum';
import { LeagueStageFormat } from './enums/league-stage-format.enum';
import { LeagueStageStatus } from './enums/league-stage-status.enum';
import { LeagueGroupPairingMode } from './league-format.types';
import type { RegionalLeagueFormat } from './league-format.types';
import {
  createCrossGroupSchedule,
  createRoundRobinSchedule,
  createSeededPairings,
  createSwissRoundSchedule,
  deriveLeagueFixtureSeed,
  LeagueScheduleSlot,
  pairingKey,
} from './league-schedule';

interface FixtureState {
  status: LeagueFixtureStatus;
  teamAWins: number;
  teamBWins: number;
  winnerTeamId: number | null;
}

interface MutableStanding {
  teamId: number;
  teamCode: string;
  teamName: string;
  played: number;
  seriesWins: number;
  seriesLosses: number;
  gameWins: number;
  gameLosses: number;
}

@Injectable()
export class LeaguesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Career)
    private readonly careersRepository: Repository<Career>,
    @InjectRepository(LeagueSplit)
    private readonly leagueSplitsRepository: Repository<LeagueSplit>,
    private readonly matchSeriesService: MatchSeriesService,
    private readonly eventQueueService: EventQueueService,
  ) {}

  async createSplit(
    accountId: number,
    careerId: number,
    dto: CreateLeagueSplitDto,
  ): Promise<LeagueSplitResponseDto> {
    const career = await this.careersRepository.findOne({
      where: { id: careerId, accountId },
      relations: { careerTeams: true },
    });

    if (!career) {
      throw new NotFoundException(`Career ${careerId} was not found`);
    }

    const regionalTeams = career.careerTeams.filter(
      (team) => team.region === dto.region,
    );

    if (regionalTeams.length < LEAGUE_CONFIG.minTeams) {
      throw new ConflictException(
        `${dto.region} needs at least ${LEAGUE_CONFIG.minTeams} teams in Career ${careerId}`,
      );
    }

    const format = getRegionalLeagueFormat(dto.region, dto.splitNumber);
    const existingSplit = await this.leagueSplitsRepository.findOneBy({
      careerId,
      year: career.currentYear,
      region: dto.region,
      splitNumber: dto.splitNumber,
    });

    if (existingSplit) {
      throw new ConflictException(
        `${dto.region} Split ${dto.splitNumber} already exists in ${career.currentYear}`,
      );
    }

    const orderedTeams = await this.orderInitialTeams(
      careerId,
      dto.region,
      dto.splitNumber,
      regionalTeams,
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        const split = await manager.save(
          LeagueSplit,
          manager.create(LeagueSplit, {
            careerId,
            career,
            year: career.currentYear,
            region: dto.region,
            splitNumber: dto.splitNumber,
            fixtures: [],
            stages: [],
          }),
        );
        const stages = format.stages.map((template, index) =>
          manager.create(LeagueStage, {
            leagueSplitId: split.id,
            leagueSplit: split,
            sequence: index + 1,
            code: template.code,
            name: template.name,
            format: template.format,
            status:
              index === 0
                ? LeagueStageStatus.ACTIVE
                : LeagueStageStatus.PLANNED,
            bestOf: template.bestOf,
            currentRound: 1,
            settings: template.settings,
            participants: [],
            fixtures: [],
          }),
        );

        split.stages = await manager.save(LeagueStage, stages);
        const firstStage = split.stages[0];
        const teamsById = new Map(orderedTeams.map((team) => [team.id, team]));
        const groupCodes = this.assignGroupCodes(
          split,
          firstStage,
          orderedTeams.map((team) => team.id),
        );

        firstStage.participants = await this.saveParticipants(
          manager,
          firstStage,
          orderedTeams.map((team) => team.id),
          teamsById,
          groupCodes,
        );
        await this.createInitialStageFixtures(manager, split, firstStage);

        return this.toResponse(split);
      });
    } catch (error) {
      if (this.isDuplicateEntryError(error)) {
        throw new ConflictException(
          `${dto.region} Split ${dto.splitNumber} already exists in ${career.currentYear}`,
        );
      }

      throw error;
    }
  }

  async findAll(
    accountId: number,
    careerId: number,
  ): Promise<LeagueSplitResponseDto[]> {
    await this.assertOwnedCareer(accountId, careerId);
    const splits = await this.leagueSplitsRepository.find({
      where: { careerId },
      relations: this.splitRelations,
      order: { year: 'DESC', splitNumber: 'DESC', region: 'ASC' },
    });

    return splits.map((split) => this.toResponse(split));
  }

  async findFormats(
    accountId: number,
    careerId: number,
  ): Promise<RegionalLeagueFormat[]> {
    await this.assertOwnedCareer(accountId, careerId);

    return Object.values(REGIONAL_LEAGUE_FORMATS).flatMap((formats) =>
      Object.values(formats),
    );
  }

  async findOne(
    accountId: number,
    careerId: number,
    splitId: number,
  ): Promise<LeagueSplitResponseDto> {
    const split = await this.findOwnedSplit(accountId, careerId, splitId);

    return this.toResponse(split);
  }

  async simulateNextFixtureGame(
    accountId: number,
    careerId: number,
    splitId: number,
    fixtureId: number,
  ): Promise<LeagueFixtureGameResponseDto> {
    await this.assertNoBlockingEvents(accountId, careerId);

    const seriesId = await this.dataSource.transaction(async (manager) => {
      const fixture = await manager.findOne(LeagueFixture, {
        where: {
          id: fixtureId,
          leagueSplitId: splitId,
          leagueSplit: { careerId, career: { accountId } },
        },
        relations: {
          leagueSplit: { career: true },
          leagueStage: true,
          teamA: true,
          teamB: true,
          series: true,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!fixture) {
        throw new NotFoundException(
          `LeagueFixture ${fixtureId} was not found in LeagueSplit ${splitId}`,
        );
      }

      if (
        fixture.leagueStage.status !== LeagueStageStatus.ACTIVE ||
        fixture.roundNumber !== fixture.leagueStage.currentRound
      ) {
        throw new ConflictException(
          `LeagueFixture ${fixtureId} is not in the active stage round`,
        );
      }

      if (fixture.scheduledDate > fixture.leagueSplit.career.currentDate) {
        throw new ConflictException(
          `LeagueFixture ${fixtureId} is scheduled for ${fixture.scheduledDate}`,
        );
      }

      if (fixture.seriesId !== null) {
        return fixture.seriesId;
      }

      const series = await manager.save(
        MatchSeries,
        manager.create(MatchSeries, {
          careerId,
          career: fixture.leagueSplit.career,
          teamAId: fixture.teamAId,
          teamA: fixture.teamA,
          teamBId: fixture.teamBId,
          teamB: fixture.teamB,
          seed: fixture.seed,
          bestOf: fixture.bestOf,
          games: [],
        }),
      );

      fixture.seriesId = series.id;
      fixture.series = series;
      await manager.save(LeagueFixture, fixture);

      return series.id;
    });
    const series = await this.matchSeriesService.simulateNextGame(
      accountId,
      seriesId,
    );

    if (series.status === MatchSeriesStatus.COMPLETED) {
      await this.progressLeague(accountId, careerId, splitId);
    }

    const split = await this.findOne(accountId, careerId, splitId);

    return { fixtureId, series, split };
  }

  private readonly splitRelations = {
    career: true,
    stages: {
      participants: { team: true },
      fixtures: {
        teamA: true,
        teamB: true,
        series: { games: true },
      },
    },
  } as const;

  private async findOwnedSplit(
    accountId: number,
    careerId: number,
    splitId: number,
  ): Promise<LeagueSplit> {
    const split = await this.leagueSplitsRepository.findOne({
      where: { id: splitId, careerId, career: { accountId } },
      relations: this.splitRelations,
    });

    if (!split) {
      throw new NotFoundException(
        `LeagueSplit ${splitId} was not found in Career ${careerId}`,
      );
    }

    this.normalizeSplitRelations(split);
    return split;
  }

  private async assertOwnedCareer(
    accountId: number,
    careerId: number,
  ): Promise<void> {
    const exists = await this.careersRepository.existsBy({
      id: careerId,
      accountId,
    });

    if (!exists) {
      throw new NotFoundException(`Career ${careerId} was not found`);
    }
  }

  private async assertNoBlockingEvents(
    accountId: number,
    careerId: number,
  ): Promise<void> {
    const career = await this.careersRepository.findOneBy({
      id: careerId,
      accountId,
    });

    if (!career) {
      throw new NotFoundException(`Career ${careerId} was not found`);
    }

    const blockingEvents = await this.dataSource.transaction(
      async (manager) => {
        await this.eventQueueService.processThroughDate(
          manager,
          careerId,
          career.currentDate,
        );

        return this.eventQueueService.findBlockingEvents(
          manager,
          careerId,
          career.currentDate,
        );
      },
    );

    if (blockingEvents.length > 0) {
      throw new ConflictException(
        `Career ${careerId} has unresolved blocking events: ${blockingEvents
          .map((event) => event.id)
          .join(', ')}`,
      );
    }
  }

  private async orderInitialTeams(
    careerId: number,
    region: Region,
    splitNumber: number,
    teams: CareerTeam[],
  ): Promise<CareerTeam[]> {
    const fallback = [...teams].sort((left, right) => left.id - right.id);

    if (splitNumber !== 3 || ![Region.LCK, Region.LPL].includes(region)) {
      return fallback;
    }

    const previousSplit = await this.leagueSplitsRepository.findOne({
      where: { careerId, region, splitNumber: 2 },
      relations: this.splitRelations,
      order: { year: 'DESC' },
    });

    if (!previousSplit) {
      throw new ConflictException(
        `${region} Split 2 must exist before Split 3 can be seeded`,
      );
    }

    this.normalizeSplitRelations(previousSplit);
    const response = this.toResponse(previousSplit);

    if (response.status !== LeagueSplitStatus.COMPLETED) {
      throw new ConflictException(
        `${region} Split 2 must be completed before Split 3`,
      );
    }

    const previousStages = this.sortedStages(previousSplit);
    const rankedTeamIds =
      region === Region.LPL
        ? [
            ...new Set(
              [...previousStages]
                .reverse()
                .flatMap((stage) =>
                  this.calculateStageStandings(stage).map(
                    (standing) => standing.teamId,
                  ),
                ),
            ),
          ].slice(
            0,
            getRegionalLeagueFormat(region, splitNumber).expectedTeamCount,
          )
        : this.calculateStageStandings(previousStages[0]).map(
            (standing) => standing.teamId,
          );
    const teamsById = new Map(teams.map((team) => [team.id, team]));

    return rankedTeamIds
      .map((teamId) => teamsById.get(teamId))
      .filter((team): team is CareerTeam => team !== undefined);
  }

  private async progressLeague(
    accountId: number,
    careerId: number,
    splitId: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const split = await manager.findOne(LeagueSplit, {
        where: { id: splitId, careerId, career: { accountId } },
        relations: this.splitRelations,
      });

      if (!split) {
        throw new NotFoundException(
          `LeagueSplit ${splitId} was not found in Career ${careerId}`,
        );
      }

      this.normalizeSplitRelations(split);
      const stage = this.sortedStages(split).find(
        (candidate) => candidate.status === LeagueStageStatus.ACTIVE,
      );

      if (!stage || !this.isCurrentRoundCompleted(stage)) {
        return;
      }

      if (await this.scheduleNextRound(manager, split, stage)) {
        return;
      }

      await this.completeStageAndActivateNext(manager, split, stage);
    });
  }

  private async scheduleNextRound(
    manager: EntityManager,
    split: LeagueSplit,
    stage: LeagueStage,
  ): Promise<boolean> {
    const maxScheduledRound = Math.max(
      0,
      ...stage.fixtures.map((fixture) => fixture.roundNumber),
    );

    if (
      [LeagueStageFormat.ROUND_ROBIN, LeagueStageFormat.GROUP].includes(
        stage.format,
      )
    ) {
      if (stage.currentRound < maxScheduledRound) {
        stage.currentRound += 1;
        await manager.save(LeagueStage, stage);
        return true;
      }

      return false;
    }

    if (stage.format === LeagueStageFormat.SWISS) {
      const totalRounds = stage.settings.swissRounds ?? 3;

      if (stage.currentRound >= totalRounds) {
        return false;
      }

      const standings = this.calculateStageStandings(stage);
      const seedsByTeamId = new Map(
        stage.participants.map((participant) => [
          participant.careerTeamId,
          participant.initialSeed,
        ]),
      );
      const previousPairings = new Set(
        stage.fixtures.map((fixture) =>
          pairingKey(fixture.teamAId, fixture.teamBId),
        ),
      );
      const nextRound = stage.currentRound + 1;
      const slots = createSwissRoundSchedule(
        standings.map((standing) => ({
          teamId: standing.teamId,
          wins: standing.seriesWins,
          seed: seedsByTeamId.get(standing.teamId)!,
        })),
        previousPairings,
        nextRound,
      );

      stage.currentRound = nextRound;
      await manager.save(LeagueStage, stage);
      await this.appendFixtures(manager, split, stage, slots);
      return slots.length > 0;
    }

    if (stage.format === LeagueStageFormat.PLAY_IN) {
      return false;
    }

    if (stage.format === LeagueStageFormat.GAUNTLET) {
      if (stage.currentRound >= stage.participants.length - 1) {
        return false;
      }

      const currentFixture = stage.fixtures.find(
        (fixture) => fixture.roundNumber === stage.currentRound,
      )!;
      const winnerTeamId =
        this.calculateFixtureState(currentFixture).winnerTeamId!;
      const nextOpponentSeed =
        stage.participants.length - stage.currentRound - 1;
      const nextOpponent = stage.participants.find(
        (participant) => participant.initialSeed === nextOpponentSeed,
      );

      if (!nextOpponent) {
        return false;
      }

      const nextRound = stage.currentRound + 1;
      stage.currentRound = nextRound;
      await manager.save(LeagueStage, stage);
      await this.appendFixtures(manager, split, stage, [
        {
          roundNumber: nextRound,
          teamAId: nextOpponent.careerTeamId,
          teamBId: winnerTeamId,
        },
      ]);
      return true;
    }

    const activeTeamIds =
      stage.format === LeagueStageFormat.DOUBLE_ELIMINATION
        ? this.getDoubleEliminationActiveTeams(stage)
        : this.getSingleEliminationActiveTeams(stage);

    if (activeTeamIds.length <= 1) {
      return false;
    }

    const seedsByTeamId = new Map(
      stage.participants.map((participant) => [
        participant.careerTeamId,
        participant.initialSeed,
      ]),
    );
    const nextRound = stage.currentRound + 1;
    const slots =
      stage.format === LeagueStageFormat.DOUBLE_ELIMINATION
        ? this.createDoubleEliminationPairings(stage, activeTeamIds, nextRound)
        : createSeededPairings(
            [...activeTeamIds].sort(
              (left, right) =>
                seedsByTeamId.get(left)! - seedsByTeamId.get(right)!,
            ),
            nextRound,
          );

    if (slots.length === 0) {
      return false;
    }

    stage.currentRound = nextRound;
    await manager.save(LeagueStage, stage);
    await this.appendFixtures(manager, split, stage, slots);
    return true;
  }

  private async completeStageAndActivateNext(
    manager: EntityManager,
    split: LeagueSplit,
    stage: LeagueStage,
  ): Promise<void> {
    stage.status = LeagueStageStatus.COMPLETED;
    await manager.save(LeagueStage, stage);

    const nextStage = this.sortedStages(split).find(
      (candidate) => candidate.sequence === stage.sequence + 1,
    );

    if (!nextStage) {
      return;
    }

    const teamIds = this.selectTeamsForStage(split, nextStage);

    if (teamIds.length < LEAGUE_CONFIG.minTeams) {
      nextStage.status = LeagueStageStatus.COMPLETED;
      await manager.save(LeagueStage, nextStage);
      await this.completeStageAndActivateNext(manager, split, nextStage);
      return;
    }

    const allParticipants = this.sortedStages(split).flatMap(
      (candidate) => candidate.participants,
    );
    const teamsById = new Map(
      allParticipants.map((participant) => [
        participant.careerTeamId,
        participant.team,
      ]),
    );
    const groupCodes = this.assignGroupCodes(split, nextStage, teamIds);

    nextStage.status = LeagueStageStatus.ACTIVE;
    nextStage.currentRound = 1;
    await manager.save(LeagueStage, nextStage);
    nextStage.participants = await this.saveParticipants(
      manager,
      nextStage,
      teamIds,
      teamsById,
      groupCodes,
    );
    await this.createInitialStageFixtures(manager, split, nextStage);
  }

  private selectTeamsForStage(
    split: LeagueSplit,
    nextStage: LeagueStage,
  ): number[] {
    const stages = this.sortedStages(split);
    const firstStage = stages[0];
    const firstRanking = this.calculateStageStandings(firstStage).map(
      (standing) => standing.teamId,
    );
    const playIn = stages.find(
      (stage) => stage.format === LeagueStageFormat.PLAY_IN,
    );
    const playInQualifiers = playIn ? this.getUnbeatenTeamIds(playIn) : [];
    const groupRankings = this.groupRankings(firstStage);
    const unique = (teamIds: number[]) => [...new Set(teamIds)];
    const key = `${split.region}:${split.splitNumber}:${nextStage.code}`;

    switch (key) {
      case `${Region.LCK}:1:PLAY_IN`: {
        const { directTeamIds } = this.getLckSplitOneDirectTeams(firstStage);
        return firstRanking
          .filter((teamId) => !directTeamIds.includes(teamId))
          .slice(0, 6);
      }
      case `${Region.LCK}:1:PLAYOFFS`:
        return unique([
          ...this.getLckSplitOneDirectTeams(firstStage).directTeamIds,
          ...playInQualifiers,
        ]);
      case `${Region.LCK}:2:PLAYOFFS`:
        return firstRanking.slice(0, 6);
      case `${Region.LCK}:3:PLAY_IN`:
        return unique([
          ...(groupRankings.get('LEGEND')?.slice(4, 5) ?? []),
          ...(groupRankings.get('RISE')?.slice(0, 3) ?? []),
        ]);
      case `${Region.LCK}:3:PLAYOFFS`:
        return unique([
          ...(groupRankings.get('LEGEND')?.slice(0, 4) ?? []),
          ...playInQualifiers,
        ]);
      case `${Region.LPL}:1:KNIGHTS_RIVAL`:
        return firstRanking.slice(4, 12);
      case `${Region.LPL}:1:PLAYOFFS`:
        return unique([...firstRanking.slice(0, 4), ...playInQualifiers]);
      case `${Region.LPL}:2:RUMBLE_STAGE`:
        return firstRanking;
      case `${Region.LPL}:2:KNIGHTS_RIVAL`: {
        const rumble = stages.find((stage) => stage.code === 'RUMBLE_STAGE')!;
        const rumbleGroups = this.groupRankings(rumble);
        return unique([
          ...(rumbleGroups.get('ASCEND')?.slice(4, 10) ?? []),
          ...(rumbleGroups.get('NIRVANA')?.slice(0, 2) ?? []),
        ]);
      }
      case `${Region.LPL}:2:PLAYOFFS`: {
        const rumble = stages.find((stage) => stage.code === 'RUMBLE_STAGE')!;
        return unique([
          ...(this.groupRankings(rumble).get('ASCEND')?.slice(0, 4) ?? []),
          ...playInQualifiers,
        ]);
      }
      case `${Region.LPL}:3:KNIGHTS_RIVAL`:
        return unique([
          ...(groupRankings.get('ASCEND')?.slice(6) ?? []),
          ...(groupRankings.get('NIRVANA')?.slice(0, 2) ?? []),
        ]);
      case `${Region.LPL}:3:PLAYOFFS`:
        return unique([
          ...(groupRankings.get('ASCEND')?.slice(0, 6) ?? []),
          ...playInQualifiers,
        ]);
      default:
        return firstRanking.slice(
          0,
          nextStage.settings.qualifierCount ?? firstRanking.length,
        );
    }
  }

  private getLckSplitOneDirectTeams(stage: LeagueStage): {
    directTeamIds: number[];
    winningGroupCode: string;
  } {
    const rankings = this.groupRankings(stage);
    const groupWins = new Map<string, number>();

    for (const [groupCode, teamIds] of rankings) {
      const teamIdSet = new Set(teamIds);
      const wins = this.calculateStageStandings(stage)
        .filter((standing) => teamIdSet.has(standing.teamId))
        .reduce((total, standing) => total + standing.seriesWins, 0);
      groupWins.set(groupCode, wins);
    }

    const [winningGroupCode, losingGroupCode] = [...groupWins.entries()]
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )
      .map(([groupCode]) => groupCode);

    return {
      winningGroupCode,
      directTeamIds: [
        ...(rankings.get(winningGroupCode)?.slice(0, 2) ?? []),
        ...(rankings.get(losingGroupCode)?.slice(0, 1) ?? []),
      ],
    };
  }

  private assignGroupCodes(
    split: LeagueSplit,
    stage: LeagueStage,
    orderedTeamIds: number[],
  ): Map<number, string | null> {
    const result = new Map<number, string | null>(
      orderedTeamIds.map((teamId) => [teamId, null]),
    );
    const configuredGroupCodes = stage.settings.groupCodes ?? [];

    if (configuredGroupCodes.length === 0) {
      return result;
    }

    if (stage.code === 'RUMBLE_STAGE') {
      const firstStage = this.sortedStages(split)[0];
      const groupRankings = this.groupRankings(firstStage);
      const firstPass = [...groupRankings.values()].flatMap((ranking) =>
        ranking.slice(0, 2),
      );
      const targetAscendCount = Math.min(
        orderedTeamIds.length,
        Math.max(2, Math.round((orderedTeamIds.length * 10) / 16)),
      );
      const remainingByRank = this.calculateStageStandings(firstStage)
        .map((standing) => standing.teamId)
        .filter((teamId) => !firstPass.includes(teamId));
      const ascend = new Set([
        ...firstPass,
        ...remainingByRank.slice(0, targetAscendCount - firstPass.length),
      ]);

      for (const teamId of orderedTeamIds) {
        result.set(teamId, ascend.has(teamId) ? 'ASCEND' : 'NIRVANA');
      }

      return result;
    }

    if (stage.code === 'LEGEND_RISE' || stage.code === 'ASCEND_NIRVANA') {
      const upperCount =
        stage.code === 'LEGEND_RISE'
          ? Math.ceil(orderedTeamIds.length / 2)
          : Math.ceil((orderedTeamIds.length * 2) / 3);

      orderedTeamIds.forEach((teamId, index) =>
        result.set(
          teamId,
          index < upperCount
            ? configuredGroupCodes[0]
            : configuredGroupCodes[1],
        ),
      );
      return result;
    }

    if (stage.settings.pairingMode === LeagueGroupPairingMode.CROSS_GROUP) {
      orderedTeamIds.forEach((teamId, index) =>
        result.set(
          teamId,
          configuredGroupCodes[index % configuredGroupCodes.length],
        ),
      );
      return result;
    }

    const effectiveGroupCount = Math.min(
      configuredGroupCodes.length,
      Math.max(1, Math.floor(orderedTeamIds.length / 2)),
    );
    const groupCodes = configuredGroupCodes.slice(0, effectiveGroupCount);

    if (stage.code === 'TIER_GROUPS') {
      orderedTeamIds.forEach((teamId, index) => {
        const groupIndex = Math.min(
          groupCodes.length - 1,
          Math.floor((index * groupCodes.length) / orderedTeamIds.length),
        );
        result.set(teamId, groupCodes[groupIndex]);
      });
      return result;
    }

    orderedTeamIds.forEach((teamId, index) =>
      result.set(teamId, groupCodes[index % groupCodes.length]),
    );
    return result;
  }

  private async saveParticipants(
    manager: EntityManager,
    stage: LeagueStage,
    teamIds: number[],
    teamsById: Map<number, CareerTeam>,
    groupCodes: Map<number, string | null>,
  ): Promise<LeagueStageParticipant[]> {
    return manager.save(
      LeagueStageParticipant,
      teamIds.map((teamId, index) =>
        manager.create(LeagueStageParticipant, {
          leagueStageId: stage.id,
          stage,
          careerTeamId: teamId,
          team: teamsById.get(teamId)!,
          initialSeed: index + 1,
          groupCode: groupCodes.get(teamId) ?? null,
        }),
      ),
    );
  }

  private async createInitialStageFixtures(
    manager: EntityManager,
    split: LeagueSplit,
    stage: LeagueStage,
  ): Promise<void> {
    const orderedParticipants = [...stage.participants].sort(
      (left, right) => left.initialSeed - right.initialSeed,
    );
    let slots: LeagueScheduleSlot[] = [];

    if (stage.format === LeagueStageFormat.ROUND_ROBIN) {
      slots = createRoundRobinSchedule(
        orderedParticipants.map((participant) => participant.careerTeamId),
        stage.settings.cycles ?? 1,
      );
    } else if (stage.format === LeagueStageFormat.GROUP) {
      slots = this.createGroupSchedule(stage, orderedParticipants);
    } else if (stage.format === LeagueStageFormat.SWISS) {
      slots = createSwissRoundSchedule(
        orderedParticipants.map((participant) => ({
          teamId: participant.careerTeamId,
          wins: 0,
          seed: participant.initialSeed,
        })),
        new Set(),
        1,
      );
    } else if (stage.format === LeagueStageFormat.GAUNTLET) {
      const openingTeams = orderedParticipants
        .slice(-2)
        .map((participant) => participant.careerTeamId);
      slots = createSeededPairings(openingTeams, 1);
    } else {
      slots = createSeededPairings(
        orderedParticipants.map((participant) => participant.careerTeamId),
        1,
      );
    }

    await this.appendFixtures(manager, split, stage, slots);
  }

  private createGroupSchedule(
    stage: LeagueStage,
    participants: LeagueStageParticipant[],
  ): LeagueScheduleSlot[] {
    const groups = new Map<string, number[]>();

    for (const participant of participants) {
      const groupCode = participant.groupCode ?? 'ALL';
      const group = groups.get(groupCode) ?? [];
      group.push(participant.careerTeamId);
      groups.set(groupCode, group);
    }

    if (stage.settings.pairingMode === LeagueGroupPairingMode.CROSS_GROUP) {
      const [first = [], second = []] = [...groups.values()];
      return createCrossGroupSchedule(
        first,
        second,
        stage.settings.cycles ?? 1,
      );
    }

    return [...groups.entries()]
      .flatMap(([groupCode, teamIds]) =>
        createRoundRobinSchedule(
          teamIds,
          stage.settings.cyclesByGroup?.[groupCode] ??
            stage.settings.cycles ??
            1,
        ),
      )
      .sort(
        (left, right) =>
          left.roundNumber - right.roundNumber || left.teamAId - right.teamAId,
      );
  }

  private async appendFixtures(
    manager: EntityManager,
    split: LeagueSplit,
    stage: LeagueStage,
    slots: LeagueScheduleSlot[],
  ): Promise<void> {
    const allFixtures = this.allFixtures(split);
    const globalStart = Math.max(
      0,
      ...allFixtures.map((fixture) => fixture.fixtureNumber),
    );
    const stageStart = Math.max(
      0,
      ...stage.fixtures.map((fixture) => fixture.stageFixtureNumber),
    );
    const teamsById = new Map(
      stage.participants.map((participant) => [
        participant.careerTeamId,
        participant.team,
      ]),
    );
    let previousScheduledDate = [...stage.fixtures]
      .map((fixture) => fixture.scheduledDate)
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1);
    const scheduledDatesByRound = new Map<number, string>();
    const fixtures = slots.map((slot, index) => {
      const fixtureNumber = globalStart + index + 1;
      let scheduledDate = scheduledDatesByRound.get(slot.roundNumber);

      if (!scheduledDate) {
        scheduledDate = getLeagueFixtureDate(
          split.year,
          split.splitNumber,
          stage.sequence,
          slot.roundNumber,
          split.career?.currentDate ?? `${split.year}-01-01`,
          previousScheduledDate,
        );
        scheduledDatesByRound.set(slot.roundNumber, scheduledDate);
        previousScheduledDate = scheduledDate;
      }

      return manager.create(LeagueFixture, {
        leagueSplitId: split.id,
        leagueSplit: split,
        leagueStageId: stage.id,
        leagueStage: stage,
        fixtureNumber,
        stageFixtureNumber: stageStart + index + 1,
        roundNumber: slot.roundNumber,
        scheduledDate,
        teamAId: slot.teamAId,
        teamA: teamsById.get(slot.teamAId)!,
        teamBId: slot.teamBId,
        teamB: teamsById.get(slot.teamBId)!,
        seed: deriveLeagueFixtureSeed(
          split.id,
          split.year,
          split.splitNumber,
          fixtureNumber,
        ),
        bestOf: stage.bestOf,
        seriesId: null,
        series: null,
      });
    });

    if (fixtures.length === 0) {
      return;
    }

    const savedFixtures = await manager.save(LeagueFixture, fixtures);
    stage.fixtures.push(...savedFixtures);
    split.fixtures.push(...savedFixtures);
  }

  private toResponse(split: LeagueSplit): LeagueSplitResponseDto {
    this.normalizeSplitRelations(split);
    const format = getRegionalLeagueFormat(split.region, split.splitNumber);
    const stages = this.sortedStages(split).map((stage) =>
      this.toStageResponse(stage),
    );
    const fixtures = stages.flatMap((stage) => stage.fixtures);
    const activeStage = stages.find(
      (stage) => stage.status === LeagueStageStatus.ACTIVE,
    );
    const allCompleted =
      stages.length > 0 &&
      stages.every((stage) => stage.status === LeagueStageStatus.COMPLETED);
    const hasStarted = fixtures.some(
      (fixture) => fixture.status !== LeagueFixtureStatus.SCHEDULED,
    );

    return {
      id: split.id,
      careerId: split.careerId,
      year: split.year,
      region: split.region,
      splitNumber: split.splitNumber,
      name: format.name,
      expectedTeamCount: format.expectedTeamCount,
      status: allCompleted
        ? LeagueSplitStatus.COMPLETED
        : hasStarted || stages[0]?.status === LeagueStageStatus.COMPLETED
          ? LeagueSplitStatus.IN_PROGRESS
          : LeagueSplitStatus.SCHEDULED,
      activeStageCode: activeStage?.code ?? null,
      stages,
      fixtures,
      standings: stages[0]?.standings ?? [],
    };
  }

  private toStageResponse(stage: LeagueStage): LeagueStageResponseDto {
    return {
      id: stage.id,
      sequence: stage.sequence,
      code: stage.code,
      name: stage.name,
      format: stage.format,
      status: stage.status,
      bestOf: stage.bestOf,
      currentRound: stage.currentRound,
      settings: stage.settings,
      participants: [...stage.participants]
        .sort((left, right) => left.initialSeed - right.initialSeed)
        .map((participant) => this.toParticipantResponse(participant)),
      fixtures: [...stage.fixtures]
        .sort(
          (left, right) => left.stageFixtureNumber - right.stageFixtureNumber,
        )
        .map((fixture) => this.toFixtureResponse(fixture)),
      standings: this.calculateStageStandings(stage),
    };
  }

  private toParticipantResponse(
    participant: LeagueStageParticipant,
  ): LeagueStageParticipantResponseDto {
    return {
      teamId: participant.careerTeamId,
      teamCode: participant.team.code,
      teamName: participant.team.name,
      initialSeed: participant.initialSeed,
      groupCode: participant.groupCode,
    };
  }

  private toFixtureResponse(fixture: LeagueFixture): LeagueFixtureResponseDto {
    const state = this.calculateFixtureState(fixture);

    return {
      id: fixture.id,
      leagueStageId: fixture.leagueStageId,
      fixtureNumber: fixture.fixtureNumber,
      stageFixtureNumber: fixture.stageFixtureNumber,
      roundNumber: fixture.roundNumber,
      scheduledDate: fixture.scheduledDate,
      bestOf: fixture.bestOf,
      seed: fixture.seed,
      status: state.status,
      seriesId: fixture.seriesId,
      teamA: this.toTeamResponse(fixture.teamA),
      teamB: this.toTeamResponse(fixture.teamB),
      teamAWins: state.teamAWins,
      teamBWins: state.teamBWins,
      winnerTeamId: state.winnerTeamId,
    };
  }

  private calculateStageStandings(
    stage: LeagueStage,
  ): LeagueStandingResponseDto[] {
    return this.calculateStandings(
      stage.fixtures,
      stage.participants.map((participant) => participant.team),
    );
  }

  private calculateStandings(
    fixtures: LeagueFixture[],
    teams: CareerTeam[],
  ): LeagueStandingResponseDto[] {
    const standingsByTeamId = new Map<number, MutableStanding>();

    for (const team of teams) {
      standingsByTeamId.set(team.id, {
        teamId: team.id,
        teamCode: team.code,
        teamName: team.name,
        played: 0,
        seriesWins: 0,
        seriesLosses: 0,
        gameWins: 0,
        gameLosses: 0,
      });
    }

    for (const fixture of fixtures) {
      const state = this.calculateFixtureState(fixture);

      if (state.status !== LeagueFixtureStatus.COMPLETED) {
        continue;
      }

      const teamAStanding = standingsByTeamId.get(fixture.teamAId)!;
      const teamBStanding = standingsByTeamId.get(fixture.teamBId)!;

      teamAStanding.played += 1;
      teamBStanding.played += 1;
      teamAStanding.gameWins += state.teamAWins;
      teamAStanding.gameLosses += state.teamBWins;
      teamBStanding.gameWins += state.teamBWins;
      teamBStanding.gameLosses += state.teamAWins;

      if (state.winnerTeamId === fixture.teamAId) {
        teamAStanding.seriesWins += 1;
        teamBStanding.seriesLosses += 1;
      } else {
        teamBStanding.seriesWins += 1;
        teamAStanding.seriesLosses += 1;
      }
    }

    return [...standingsByTeamId.values()]
      .sort(
        (left, right) =>
          right.seriesWins - left.seriesWins ||
          right.gameWins -
            right.gameLosses -
            (left.gameWins - left.gameLosses) ||
          right.gameWins - left.gameWins ||
          left.teamCode.localeCompare(right.teamCode),
      )
      .map((standing, index) => ({
        rank: index + 1,
        ...standing,
        gameDifference: standing.gameWins - standing.gameLosses,
      }));
  }

  private groupRankings(stage: LeagueStage): Map<string, number[]> {
    const standingsByTeamId = new Map(
      this.calculateStageStandings(stage).map((standing) => [
        standing.teamId,
        standing,
      ]),
    );
    const groups = new Map<string, LeagueStageParticipant[]>();

    for (const participant of stage.participants) {
      const groupCode = participant.groupCode ?? 'ALL';
      const group = groups.get(groupCode) ?? [];
      group.push(participant);
      groups.set(groupCode, group);
    }

    return new Map(
      [...groups.entries()].map(([groupCode, participants]) => [
        groupCode,
        participants
          .sort((left, right) => {
            const leftStanding = standingsByTeamId.get(left.careerTeamId)!;
            const rightStanding = standingsByTeamId.get(right.careerTeamId)!;
            return (
              rightStanding.seriesWins - leftStanding.seriesWins ||
              rightStanding.gameDifference - leftStanding.gameDifference ||
              left.initialSeed - right.initialSeed
            );
          })
          .map((participant) => participant.careerTeamId),
      ]),
    );
  }

  private calculateFixtureState(fixture: LeagueFixture): FixtureState {
    if (!fixture.series) {
      return {
        status: LeagueFixtureStatus.SCHEDULED,
        teamAWins: 0,
        teamBWins: 0,
        winnerTeamId: null,
      };
    }

    const teamAWins = (fixture.series.games ?? []).filter(
      (game) => game.winnerTeamId === fixture.teamAId,
    ).length;
    const teamBWins = (fixture.series.games ?? []).filter(
      (game) => game.winnerTeamId === fixture.teamBId,
    ).length;
    const winsRequired = getSeriesWinsRequired(fixture.bestOf);
    const winnerTeamId =
      teamAWins >= winsRequired
        ? fixture.teamAId
        : teamBWins >= winsRequired
          ? fixture.teamBId
          : null;

    return {
      status:
        winnerTeamId === null
          ? LeagueFixtureStatus.IN_PROGRESS
          : LeagueFixtureStatus.COMPLETED,
      teamAWins,
      teamBWins,
      winnerTeamId,
    };
  }

  private isCurrentRoundCompleted(stage: LeagueStage): boolean {
    const fixtures = stage.fixtures.filter(
      (fixture) => fixture.roundNumber === stage.currentRound,
    );

    return (
      fixtures.length > 0 &&
      fixtures.every(
        (fixture) =>
          this.calculateFixtureState(fixture).status ===
          LeagueFixtureStatus.COMPLETED,
      )
    );
  }

  private getSingleEliminationActiveTeams(stage: LeagueStage): number[] {
    const currentRoundFixtures = stage.fixtures.filter(
      (fixture) => fixture.roundNumber === stage.currentRound,
    );
    const involvedTeamIds = new Set(
      currentRoundFixtures.flatMap((fixture) => [
        fixture.teamAId,
        fixture.teamBId,
      ]),
    );
    const winners = currentRoundFixtures.map(
      (fixture) => this.calculateFixtureState(fixture).winnerTeamId!,
    );
    const byeTeams = stage.participants
      .map((participant) => participant.careerTeamId)
      .filter((teamId) => !involvedTeamIds.has(teamId))
      .filter(
        (teamId) =>
          !stage.fixtures.some(
            (fixture) =>
              fixture.roundNumber < stage.currentRound &&
              [fixture.teamAId, fixture.teamBId].includes(teamId) &&
              this.calculateFixtureState(fixture).winnerTeamId !== teamId,
          ),
      );

    return [...new Set([...winners, ...byeTeams])];
  }

  private getDoubleEliminationActiveTeams(stage: LeagueStage): number[] {
    const losses = this.getLossCounts(stage);

    return stage.participants
      .filter((participant) => (losses.get(participant.careerTeamId) ?? 0) < 2)
      .map((participant) => participant.careerTeamId);
  }

  private createDoubleEliminationPairings(
    stage: LeagueStage,
    activeTeamIds: number[],
    roundNumber: number,
  ): LeagueScheduleSlot[] {
    const losses = this.getLossCounts(stage);
    const seeds = new Map(
      stage.participants.map((participant) => [
        participant.careerTeamId,
        participant.initialSeed,
      ]),
    );
    const unpaired: number[] = [];
    const slots = [0, 1].flatMap((lossCount) => {
      const group = activeTeamIds
        .filter((teamId) => (losses.get(teamId) ?? 0) === lossCount)
        .sort((left, right) => seeds.get(left)! - seeds.get(right)!);

      if (group.length % 2 !== 0) {
        unpaired.push(group.shift()!);
      }

      return createSeededPairings(group, roundNumber);
    });

    if (unpaired.length >= 2) {
      slots.push(...createSeededPairings(unpaired, roundNumber));
    }

    return slots;
  }

  private getLossCounts(stage: LeagueStage): Map<number, number> {
    const losses = new Map(
      stage.participants.map((participant) => [participant.careerTeamId, 0]),
    );

    for (const fixture of stage.fixtures) {
      const winnerTeamId = this.calculateFixtureState(fixture).winnerTeamId;

      if (winnerTeamId === null) {
        continue;
      }

      const loserTeamId =
        winnerTeamId === fixture.teamAId ? fixture.teamBId : fixture.teamAId;
      losses.set(loserTeamId, (losses.get(loserTeamId) ?? 0) + 1);
    }

    return losses;
  }

  private getUnbeatenTeamIds(stage: LeagueStage): number[] {
    const losses = this.getLossCounts(stage);

    return [...stage.participants]
      .sort((left, right) => left.initialSeed - right.initialSeed)
      .filter(
        (participant) => (losses.get(participant.careerTeamId) ?? 0) === 0,
      )
      .map((participant) => participant.careerTeamId);
  }

  private toTeamResponse(team: CareerTeam): LeagueFixtureTeamResponseDto {
    return { id: team.id, code: team.code, name: team.name };
  }

  private allFixtures(split: LeagueSplit): LeagueFixture[] {
    return this.sortedStages(split).flatMap((stage) => stage.fixtures ?? []);
  }

  private sortedStages(split: LeagueSplit): LeagueStage[] {
    return [...(split.stages ?? [])].sort(
      (left, right) => left.sequence - right.sequence,
    );
  }

  private normalizeSplitRelations(split: LeagueSplit): void {
    split.stages ??= [];

    for (const stage of split.stages) {
      stage.participants ??= [];
      stage.fixtures ??= [];
    }

    split.fixtures = this.allFixtures(split);
  }

  private isDuplicateEntryError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { code?: string } | undefined;

    return driverError?.code === 'ER_DUP_ENTRY';
  }
}
