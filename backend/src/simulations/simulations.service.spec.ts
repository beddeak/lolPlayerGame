import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CalendarsService } from '../calendars/calendars.service';
import { CalendarResponseDto } from '../calendars/dto/calendar-response.dto';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Career } from '../careers/entities/career.entity';
import { Region } from '../careers/enums/region.enum';
import { CalendarEventResponseDto } from '../event-queue/dto/calendar-event-response.dto';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { EventQueueService } from '../event-queue/event-queue.service';
import {
  LeagueFixtureGameResponseDto,
  LeagueFixtureResponseDto,
  LeagueSplitResponseDto,
} from '../leagues/dto/league-split-response.dto';
import { LeagueFixtureStatus } from '../leagues/enums/league-fixture-status.enum';
import { LeagueSplitStatus } from '../leagues/enums/league-split-status.enum';
import { LeaguesService } from '../leagues/leagues.service';
import { MatchSeriesStatus } from '../match-series/enums/match-series-status.enum';
import { FastSimStopReason } from './enums/fast-sim-stop-reason.enum';
import { SimulationsService } from './simulations.service';

describe('SimulationsService', () => {
  const career = {
    id: 1,
    accountId: 7,
    currentDate: '2026-01-01',
    currentYear: 2026,
  } as Career;
  const managedTeam = {
    id: 1,
    careerId: career.id,
    isUserControlled: true,
  } as CareerTeam;
  const entityManager = {
    findOne: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(
      (work: (manager: typeof entityManager) => Promise<unknown>) =>
        work(entityManager),
    ),
  };
  const careerTeamsRepository = {
    findOne: jest.fn(),
  };
  const calendarsService = {
    findOne: jest.fn(),
    advance: jest.fn(),
  };
  const eventQueueService = {
    processThroughDate: jest.fn(),
    findBlockingEvents: jest.fn(),
  };
  const leaguesService = {
    findOne: jest.fn(),
    simulateNextFixtureGame: jest.fn(),
  };

  let service: SimulationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    career.currentDate = '2026-01-01';
    entityManager.findOne.mockResolvedValue(career);
    careerTeamsRepository.findOne.mockResolvedValue(managedTeam);
    eventQueueService.processThroughDate.mockResolvedValue({
      processedEvents: [],
      blockingEvents: [],
    });
    eventQueueService.findBlockingEvents.mockResolvedValue([]);
    service = new SimulationsService(
      dataSource as unknown as DataSource,
      careerTeamsRepository as unknown as Repository<CareerTeam>,
      calendarsService as unknown as CalendarsService,
      eventQueueService as unknown as EventQueueService,
      leaguesService as unknown as LeaguesService,
    );
  });

  it('quick-simulates every remaining game in a BO3 and returns the detailed series', async () => {
    const scheduledFixture = createFixture(10, 1, 2);
    const completedFixture = {
      ...scheduledFixture,
      status: LeagueFixtureStatus.COMPLETED,
      seriesId: 50,
      teamAWins: 2,
      winnerTeamId: scheduledFixture.teamA.id,
    };
    const splitBefore = createSplit(scheduledFixture);
    const gameOne = createFixtureGameResult(
      scheduledFixture,
      splitBefore,
      1,
      MatchSeriesStatus.IN_PROGRESS,
    );
    const completedSplit = createSplit(completedFixture);
    const gameTwo = createFixtureGameResult(
      completedFixture,
      completedSplit,
      2,
      MatchSeriesStatus.COMPLETED,
    );

    leaguesService.findOne.mockResolvedValue(splitBefore);
    leaguesService.simulateNextFixtureGame
      .mockResolvedValueOnce(gameOne)
      .mockResolvedValueOnce(gameTwo);

    const result = await service.quickSim(7, career.id, {
      leagueSplitId: splitBefore.id,
      fixtureId: scheduledFixture.id,
    });

    expect(result.gamesSimulated).toBe(2);
    expect(result.series.status).toBe(MatchSeriesStatus.COMPLETED);
    expect(result.series.games).toHaveLength(2);
    expect(leaguesService.simulateNextFixtureGame).toHaveBeenCalledTimes(2);
  });

  it('resumes an in-progress series without replaying completed games', async () => {
    const fixture = createFixture(10, 1, 2);
    fixture.status = LeagueFixtureStatus.IN_PROGRESS;
    fixture.seriesId = 50;
    fixture.teamAWins = 1;
    const completedFixture = {
      ...fixture,
      status: LeagueFixtureStatus.COMPLETED,
      teamAWins: 2,
      winnerTeamId: fixture.teamA.id,
    };
    const splitBefore = createSplit(fixture);
    const completedSplit = createSplit(completedFixture);

    leaguesService.findOne.mockResolvedValue(splitBefore);
    leaguesService.simulateNextFixtureGame.mockResolvedValue(
      createFixtureGameResult(
        completedFixture,
        completedSplit,
        2,
        MatchSeriesStatus.COMPLETED,
      ),
    );

    const result = await service.quickSim(7, career.id, {
      leagueSplitId: splitBefore.id,
      fixtureId: fixture.id,
    });

    expect(result.gamesSimulated).toBe(1);
    expect(leaguesService.simulateNextFixtureGame).toHaveBeenCalledTimes(1);
  });

  it('blocks quick sim when a current user-action event is unresolved', async () => {
    eventQueueService.findBlockingEvents.mockResolvedValue([
      createBlockingEvent(),
    ]);

    await expect(
      service.quickSim(7, career.id, {
        leagueSplitId: 20,
        fixtureId: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(leaguesService.findOne).not.toHaveBeenCalled();
  });

  it('fast-simulates AI fixtures but stops before the managed team match', async () => {
    const aiFixture = createFixture(10, 2, 3);
    const managedFixture = createFixture(11, managedTeam.id, 2);
    const initialCalendar = createCalendar('2026-01-01', [
      toCalendarFixture(aiFixture),
      toCalendarFixture(managedFixture),
    ]);
    const stoppedCalendar = createCalendar('2026-01-01', [
      toCalendarFixture(managedFixture),
    ]);
    const completedAiFixture = {
      ...aiFixture,
      status: LeagueFixtureStatus.COMPLETED,
      seriesId: 50,
      teamAWins: 2,
      winnerTeamId: aiFixture.teamA.id,
    };
    const splitBefore = createSplit(aiFixture);
    const completedSplit = createSplit(completedAiFixture);

    calendarsService.findOne
      .mockResolvedValueOnce(initialCalendar)
      .mockResolvedValueOnce(stoppedCalendar);
    leaguesService.findOne.mockResolvedValue(splitBefore);
    leaguesService.simulateNextFixtureGame
      .mockResolvedValueOnce(
        createFixtureGameResult(
          aiFixture,
          splitBefore,
          1,
          MatchSeriesStatus.IN_PROGRESS,
        ),
      )
      .mockResolvedValueOnce(
        createFixtureGameResult(
          completedAiFixture,
          completedSplit,
          2,
          MatchSeriesStatus.COMPLETED,
        ),
      );

    const result = await service.fastSim(7, career.id, { days: 7 });

    expect(result.stopReason).toBe(FastSimStopReason.MANAGED_MATCH);
    expect(result.simulatedFixtures).toHaveLength(1);
    expect(result.simulatedFixtures[0]).toEqual(
      expect.objectContaining({
        fixtureId: aiFixture.id,
        gamesSimulated: 2,
        winnerTeamId: aiFixture.teamA.id,
      }),
    );
    expect(calendarsService.advance).not.toHaveBeenCalled();
  });

  it('fast-forwards through empty days until the requested target date', async () => {
    calendarsService.findOne.mockImplementation(() =>
      Promise.resolve(createCalendar(career.currentDate, [])),
    );
    calendarsService.advance.mockImplementation(() => {
      career.currentDate =
        career.currentDate === '2026-01-01' ? '2026-01-02' : '2026-01-03';
      return Promise.resolve(createCalendar(career.currentDate, []));
    });

    const result = await service.fastSim(7, career.id, { days: 2 });

    expect(result.stopReason).toBe(FastSimStopReason.TARGET_REACHED);
    expect(result.currentDate).toBe('2026-01-03');
    expect(result.advancedDays).toBe(2);
    expect(calendarsService.advance).toHaveBeenCalledTimes(2);
  });

  it('stops at the fixture limit and returns a refreshed calendar', async () => {
    const firstFixture = createFixture(10, 2, 3);
    const secondFixture = createFixture(11, 3, 4);
    const initialCalendar = createCalendar('2026-01-01', [
      toCalendarFixture(firstFixture),
      toCalendarFixture(secondFixture),
    ]);
    const refreshedCalendar = createCalendar('2026-01-01', [
      toCalendarFixture(secondFixture),
    ]);
    const completedFixture = {
      ...firstFixture,
      status: LeagueFixtureStatus.COMPLETED,
      seriesId: 50,
      teamAWins: 2,
      winnerTeamId: firstFixture.teamA.id,
    };

    calendarsService.findOne
      .mockResolvedValueOnce(initialCalendar)
      .mockResolvedValueOnce(refreshedCalendar);
    leaguesService.findOne.mockResolvedValue(createSplit(firstFixture));
    leaguesService.simulateNextFixtureGame
      .mockResolvedValueOnce(
        createFixtureGameResult(
          firstFixture,
          createSplit(firstFixture),
          1,
          MatchSeriesStatus.IN_PROGRESS,
        ),
      )
      .mockResolvedValueOnce(
        createFixtureGameResult(
          completedFixture,
          createSplit(completedFixture),
          2,
          MatchSeriesStatus.COMPLETED,
        ),
      );

    const result = await service.fastSim(7, career.id, {
      days: 7,
      maxFixtures: 1,
    });

    expect(result.stopReason).toBe(FastSimStopReason.FIXTURE_LIMIT);
    expect(result.simulatedFixtures).toHaveLength(1);
    expect(result.calendar.dueMatches.map((fixture) => fixture.id)).toEqual([
      secondFixture.id,
    ]);
  });

  it('returns a blocking stop without moving the date or simulating a fixture', async () => {
    const blockingEvent = createBlockingEvent();
    eventQueueService.findBlockingEvents.mockResolvedValue([blockingEvent]);
    calendarsService.findOne.mockResolvedValue(
      createCalendar('2026-01-01', [], [blockingEvent]),
    );

    const result = await service.fastSim(7, career.id, { days: 7 });

    expect(result.stopReason).toBe(FastSimStopReason.BLOCKING_EVENT);
    expect(result.advancedDays).toBe(0);
    expect(leaguesService.simulateNextFixtureGame).not.toHaveBeenCalled();
    expect(calendarsService.advance).not.toHaveBeenCalled();
  });
});

function createFixture(
  id: number,
  teamAId: number,
  teamBId: number,
): LeagueFixtureResponseDto {
  return {
    id,
    leagueStageId: 30,
    fixtureNumber: id,
    stageFixtureNumber: id,
    roundNumber: 1,
    scheduledDate: '2026-01-01',
    bestOf: 3,
    seed: 1234,
    status: LeagueFixtureStatus.SCHEDULED,
    seriesId: null,
    teamA: { id: teamAId, code: `T${teamAId}`, name: `Team ${teamAId}` },
    teamB: { id: teamBId, code: `T${teamBId}`, name: `Team ${teamBId}` },
    teamAWins: 0,
    teamBWins: 0,
    winnerTeamId: null,
  };
}

function createSplit(
  fixture: LeagueFixtureResponseDto,
): LeagueSplitResponseDto {
  return {
    id: 20,
    careerId: 1,
    year: 2026,
    region: Region.LCK,
    splitNumber: 1,
    name: 'LCK Split 1',
    expectedTeamCount: 10,
    status: LeagueSplitStatus.IN_PROGRESS,
    activeStageCode: 'GROUP_BATTLE',
    stages: [],
    fixtures: [fixture],
    standings: [],
  };
}

function createFixtureGameResult(
  fixture: LeagueFixtureResponseDto,
  split: LeagueSplitResponseDto,
  gameCount: number,
  status: MatchSeriesStatus,
): LeagueFixtureGameResponseDto {
  return {
    fixtureId: fixture.id,
    split,
    series: {
      seriesId: 50,
      careerId: 1,
      bestOf: fixture.bestOf,
      winsRequired: 2,
      status,
      winnerTeamId:
        status === MatchSeriesStatus.COMPLETED ? fixture.teamA.id : null,
      nextGameNumber:
        status === MatchSeriesStatus.COMPLETED ? null : gameCount + 1,
      seed: fixture.seed,
      teams: [
        {
          teamId: fixture.teamA.id,
          teamCode: fixture.teamA.code,
          wins: gameCount,
        },
        { teamId: fixture.teamB.id, teamCode: fixture.teamB.code, wins: 0 },
      ],
      games: Array.from({ length: gameCount }, () => ({}) as never),
    },
  };
}

function toCalendarFixture(
  fixture: LeagueFixtureResponseDto,
): CalendarResponseDto['dueMatches'][number] {
  return {
    id: fixture.id,
    scheduledDate: fixture.scheduledDate,
    leagueSplitId: 20,
    leagueStageId: fixture.leagueStageId,
    year: 2026,
    region: Region.LCK,
    splitNumber: 1,
    stageCode: 'GROUP_BATTLE',
    roundNumber: fixture.roundNumber,
    bestOf: fixture.bestOf,
    teamA: fixture.teamA,
    teamB: fixture.teamB,
  };
}

function createCalendar(
  currentDate: string,
  dueMatches: CalendarResponseDto['dueMatches'],
  blockingEvents: CalendarEventResponseDto[] = [],
): CalendarResponseDto {
  return {
    careerId: 1,
    currentDate,
    currentYear: 2026,
    nextMatch: dueMatches[0] ?? null,
    dueMatches,
    blockingEvents,
  };
}

function createBlockingEvent(): CalendarEventResponseDto {
  return {
    id: 99,
    careerId: 1,
    scheduledDate: '2026-01-01',
    type: CalendarEventType.PLAYER_MEETING,
    status: CalendarEventStatus.READY,
    requiresUserAction: true,
    payload: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
  };
}
