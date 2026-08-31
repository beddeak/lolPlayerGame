import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Region } from '../careers/enums/region.enum';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { Match } from '../matches/entities/match.entity';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { LeagueSplit } from '../leagues/entities/league-split.entity';
import { LeagueStage } from '../leagues/entities/league-stage.entity';
import { CalendarEventResponseDto } from '../event-queue/dto/calendar-event-response.dto';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { EventQueueService } from '../event-queue/event-queue.service';
import { CalendarsService } from './calendars.service';
import { CalendarAdvanceMode } from './enums/calendar-advance-mode.enum';
import { CalendarStopReason } from './enums/calendar-stop-reason.enum';

describe('CalendarsService', () => {
  const career = {
    id: 1,
    accountId: 7,
    startYear: 2026,
    currentYear: 2026,
    currentDate: '2026-01-01',
  } as Career;
  const fixturesRepository = {
    find: jest.fn(),
  };
  const careersRepository = {
    findOneBy: jest.fn(),
  };
  const entityManager = {
    findOne: jest.fn(),
    getRepository: jest.fn(() => fixturesRepository),
    save: jest.fn((_: unknown, value: unknown) => Promise.resolve(value)),
  };
  const dataSource = {
    manager: entityManager,
    transaction: jest.fn(
      (work: (manager: typeof entityManager) => Promise<unknown>) =>
        work(entityManager),
    ),
  };
  const eventQueueService = {
    processThroughDate: jest.fn(),
    findBlockingEvents: jest.fn(),
    findNextScheduledEvent: jest.fn(),
  };

  let service: CalendarsService;
  let fixture: LeagueFixture;

  beforeEach(() => {
    jest.clearAllMocks();
    career.currentDate = '2026-01-01';
    career.currentYear = 2026;
    fixture = createFixture(10, '2026-01-12');
    careersRepository.findOneBy.mockResolvedValue(career);
    entityManager.findOne.mockResolvedValue(career);
    fixturesRepository.find.mockResolvedValue([fixture]);
    eventQueueService.processThroughDate.mockResolvedValue({
      processedEvents: [],
      blockingEvents: [],
    });
    eventQueueService.findBlockingEvents.mockResolvedValue([]);
    eventQueueService.findNextScheduledEvent.mockResolvedValue(null);
    service = new CalendarsService(
      dataSource as unknown as DataSource,
      careersRepository as unknown as Repository<Career>,
      fixturesRepository as unknown as Repository<LeagueFixture>,
      eventQueueService as unknown as EventQueueService,
    );
  });

  it('returns the current date and the earliest incomplete match', async () => {
    const result = await service.findOne(7, career.id);

    expect(result.careerId).toBe(career.id);
    expect(result.currentDate).toBe('2026-01-01');
    expect(result.currentYear).toBe(2026);
    expect(result.dueMatches).toEqual([]);
    expect(result.nextMatch?.id).toBe(fixture.id);
    expect(result.nextMatch?.scheduledDate).toBe('2026-01-12');
    expect(result.nextMatch?.region).toBe(Region.LCK);
  });

  it('advances three days when there is no match in the interval', async () => {
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.THREE_DAYS,
    });

    expect(result.currentDate).toBe('2026-01-04');
    expect(result.advancedDays).toBe(3);
    expect(result.stopReason).toBe(CalendarStopReason.TARGET_REACHED);
  });

  it('processes non-blocking events without stopping the calendar', async () => {
    const completedEvent = createEventResponse(
      1,
      '2026-01-02',
      false,
      CalendarEventStatus.COMPLETED,
    );
    eventQueueService.processThroughDate.mockImplementation(
      (_manager: unknown, _careerId: number, date: string) =>
        Promise.resolve({
          processedEvents: date === '2026-01-02' ? [completedEvent] : [],
          blockingEvents: [],
        }),
    );

    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.THREE_DAYS,
    });

    expect(result.currentDate).toBe('2026-01-04');
    expect(result.stopReason).toBe(CalendarStopReason.TARGET_REACHED);
    expect(result.processedEvents).toEqual([completedEvent]);
  });

  it('stops immediately when a user-action event becomes ready', async () => {
    const blockingEvent = createEventResponse(
      2,
      '2026-01-03',
      true,
      CalendarEventStatus.READY,
    );
    eventQueueService.processThroughDate.mockImplementation(
      (_manager: unknown, _careerId: number, date: string) =>
        Promise.resolve({
          processedEvents: date === '2026-01-03' ? [blockingEvent] : [],
          blockingEvents: date === '2026-01-03' ? [blockingEvent] : [],
        }),
    );
    eventQueueService.findBlockingEvents.mockImplementation(
      (_repository: unknown, _careerId: number, date: string) =>
        Promise.resolve(date >= '2026-01-03' ? [blockingEvent] : []),
    );

    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.THREE_DAYS,
    });

    expect(result.currentDate).toBe('2026-01-03');
    expect(result.advancedDays).toBe(2);
    expect(result.stopReason).toBe(CalendarStopReason.BLOCKING_EVENT);
    expect(result.blockingEvents).toEqual([blockingEvent]);
  });

  it('fast-forwards to the next scheduled event', async () => {
    eventQueueService.findNextScheduledEvent.mockResolvedValue({
      id: 3,
      careerId: career.id,
      scheduledDate: '2026-01-05',
      status: CalendarEventStatus.SCHEDULED,
    });

    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.NEXT_EVENT,
    });

    expect(result.currentDate).toBe('2026-01-05');
    expect(result.stopReason).toBe(CalendarStopReason.TARGET_REACHED);
  });

  it('fast-forwards to the next match and stops on match day', async () => {
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.NEXT_MATCH,
    });

    expect(result.currentDate).toBe('2026-01-12');
    expect(result.advancedDays).toBe(11);
    expect(result.stopReason).toBe(CalendarStopReason.MATCH_DAY);
    expect(result.dueMatches.map((match) => match.id)).toEqual([fixture.id]);
  });

  it('does not move past an unresolved match already due today', async () => {
    career.currentDate = fixture.scheduledDate;

    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.ONE_DAY,
    });

    expect(result.currentDate).toBe('2026-01-12');
    expect(result.advancedDays).toBe(0);
    expect(result.stopReason).toBe(CalendarStopReason.MATCH_DAY);
  });

  it('skips completed series when selecting the next match', async () => {
    fixture.series = {
      games: [
        { winnerTeamId: fixture.teamAId } as Match,
        { winnerTeamId: fixture.teamAId } as Match,
      ],
    } as MatchSeries;
    const laterFixture = createFixture(11, '2026-01-15');
    fixturesRepository.find.mockResolvedValue([fixture, laterFixture]);

    const result = await service.findOne(7, career.id);

    expect(result.nextMatch?.id).toBe(laterFixture.id);
  });

  it('updates the career year when a day crosses New Year', async () => {
    career.currentDate = '2026-12-31';
    fixturesRepository.find.mockResolvedValue([]);

    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.ONE_DAY,
    });

    expect(result.currentDate).toBe('2027-01-01');
    expect(result.currentYear).toBe(2027);
  });

  it('rejects next-match movement when nothing is scheduled', async () => {
    fixturesRepository.find.mockResolvedValue([]);

    await expect(
      service.advance(7, career.id, {
        mode: CalendarAdvanceMode.NEXT_MATCH,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not expose another account career', async () => {
    careersRepository.findOneBy.mockResolvedValue(null);

    await expect(service.findOne(8, career.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

function createFixture(id: number, scheduledDate: string): LeagueFixture {
  const teamA = { id: 1, code: 'AAA', name: 'Alpha' } as CareerTeam;
  const teamB = { id: 2, code: 'BBB', name: 'Beta' } as CareerTeam;

  return {
    id,
    leagueSplitId: 20,
    leagueStageId: 30,
    scheduledDate,
    roundNumber: 1,
    bestOf: 3,
    teamAId: teamA.id,
    teamBId: teamB.id,
    teamA,
    teamB,
    leagueSplit: {
      id: 20,
      year: 2026,
      region: Region.LCK,
      splitNumber: 1,
    } as LeagueSplit,
    leagueStage: { id: 30, code: 'REGULAR_SEASON' } as LeagueStage,
    series: null,
  } as LeagueFixture;
}

function createEventResponse(
  id: number,
  scheduledDate: string,
  requiresUserAction: boolean,
  status: CalendarEventStatus,
): CalendarEventResponseDto {
  return {
    id,
    careerId: 1,
    scheduledDate,
    type: CalendarEventType.PLAYER_MEETING,
    status,
    requiresUserAction,
    payload: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    completedAt:
      status === CalendarEventStatus.COMPLETED
        ? new Date('2026-01-02T00:00:00Z')
        : null,
  };
}
