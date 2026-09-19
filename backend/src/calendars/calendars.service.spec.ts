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
import { SeasonScheduleService } from './season-schedule.service';
import { ManagerCareerService } from '../manager-career/manager-career.service';
import { CalendarAdvanceMode } from './enums/calendar-advance-mode.enum';
import { CalendarStopReason } from './enums/calendar-stop-reason.enum';
import { DailyFormRecoveryService } from './daily-form-recovery.service';

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
    canAdvancePastTransferWindowClose: jest.fn(),
  };
  const seasonScheduleService = {
    prepare: jest.fn(),
    describe: jest.fn(),
  };
  const dailyFormRecovery = {
    apply: jest
      .fn<
        ReturnType<DailyFormRecoveryService['apply']>,
        Parameters<DailyFormRecoveryService['apply']>
      >()
      .mockResolvedValue(undefined),
  };

  let service: CalendarsService;
  let fixture: LeagueFixture;

  beforeEach(() => {
    jest.clearAllMocks();
    career.currentDate = '2026-01-01';
    career.currentYear = 2026;
    career.autoSchedule = false;
    seasonScheduleService.prepare.mockResolvedValue(undefined);
    seasonScheduleService.describe.mockResolvedValue([]);
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
    eventQueueService.canAdvancePastTransferWindowClose.mockResolvedValue(
      false,
    );
    service = new CalendarsService(
      dataSource as unknown as DataSource,
      careersRepository as unknown as Repository<Career>,
      fixturesRepository as unknown as Repository<LeagueFixture>,
      eventQueueService as unknown as EventQueueService,
      seasonScheduleService as unknown as SeasonScheduleService,
      {
        describe: jest
          .fn()
          .mockResolvedValue({ status: 'ACTIVE', canManage: true }),
      } as unknown as ManagerCareerService,
      dailyFormRecovery,
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
    expect(dailyFormRecovery.apply).not.toHaveBeenCalled();
  });

  it('NEXT_MATCH also targets international match events without a regional fixture', async () => {
    career.currentDate = '2026-03-15';
    fixturesRepository.find.mockResolvedValue([]);
    eventQueueService.findNextScheduledEvent.mockResolvedValue({
      scheduledDate: '2026-03-16',
      type: CalendarEventType.SCHEDULED_GAME,
    });
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.NEXT_MATCH,
    });
    expect(result.currentDate).toBe('2026-03-16');
    expect(eventQueueService.findNextScheduledEvent).toHaveBeenCalledWith(
      entityManager,
      career.id,
      CalendarEventType.SCHEDULED_GAME,
    );
  });

  it('advances three days when there is no match in the interval', async () => {
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.THREE_DAYS,
    });

    expect(result.currentDate).toBe('2026-01-04');
    expect(dailyFormRecovery.apply.mock.calls.map((call) => call[2])).toEqual([
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
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

  it('stops a multi-day advance when the transfer market opens', async () => {
    career.currentDate = '2026-11-18';
    career.currentYear = 2026;
    fixture = createFixture(10, '2027-01-12');
    fixturesRepository.find.mockResolvedValue([fixture]);

    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.THREE_DAYS,
    });

    expect(result.currentDate).toBe('2026-11-19');
    expect(result.advancedDays).toBe(1);
    expect(result.transferWindow.isOpen).toBe(true);
    expect(result.stopReason).toBe(CalendarStopReason.TRANSFER_WINDOW_BOUNDARY);
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
    expect(dailyFormRecovery.apply).not.toHaveBeenCalled();
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
    expect(dailyFormRecovery.apply).toHaveBeenCalledWith(
      entityManager,
      career.id,
      '2027-01-01',
    );
    expect(result.stopReason).toBe(CalendarStopReason.TRANSFER_WINDOW_BOUNDARY);
  });

  it('rejects next-match movement when nothing is scheduled', async () => {
    fixturesRepository.find.mockResolvedValue([]);

    await expect(
      service.advance(7, career.id, {
        mode: CalendarAdvanceMode.NEXT_MATCH,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps a December 31 match and acquisition response on the same day', async () => {
    career.currentDate = '2026-12-31';
    fixture = createFixture(10, career.currentDate);
    fixturesRepository.find.mockResolvedValue([fixture]);
    const response = {
      ...createEventResponse(
        20,
        career.currentDate,
        true,
        CalendarEventStatus.READY,
      ),
      type: CalendarEventType.CONTRACT_RESPONSE,
    };
    eventQueueService.findBlockingEvents.mockResolvedValue([response]);
    eventQueueService.canAdvancePastTransferWindowClose.mockResolvedValue(true);

    const before = await service.findOne(7, career.id);
    expect(before.canCloseTransferWindow).toBe(false);
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.ONE_DAY,
    });

    expect(result.currentDate).toBe('2026-12-31');
    expect(result.currentYear).toBe(2026);
    expect(result.advancedDays).toBe(0);
    expect(result.stopReason).toBe(CalendarStopReason.BLOCKING_EVENT);
    expect(result.canCloseTransferWindow).toBe(false);
    expect(result.dueMatches.map((match) => match.id)).toEqual([10]);
    expect(eventQueueService.processThroughDate).toHaveBeenCalledTimes(1);
    expect(
      eventQueueService.canAdvancePastTransferWindowClose,
    ).not.toHaveBeenCalled();
  });

  it('advertises a safe closing action and clears it after advancing', async () => {
    career.currentDate = '2026-12-31';
    fixturesRepository.find.mockResolvedValue([]);
    const response = {
      ...createEventResponse(
        20,
        career.currentDate,
        true,
        CalendarEventStatus.READY,
      ),
      type: CalendarEventType.CONTRACT_RESPONSE,
    };
    eventQueueService.findBlockingEvents.mockImplementation(
      (_manager: unknown, _careerId: number, date: string) =>
        Promise.resolve(date === '2026-12-31' ? [response] : []),
    );
    eventQueueService.canAdvancePastTransferWindowClose.mockImplementation(
      (_manager: unknown, _careerId: number, date: string) =>
        Promise.resolve(date === '2026-12-31'),
    );
    expect((await service.findOne(7, career.id)).canCloseTransferWindow).toBe(
      true,
    );
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.ONE_DAY,
    });
    expect(result.currentDate).toBe('2027-01-01');
    expect(result.advancedDays).toBe(1);
    expect(result.canCloseTransferWindow).toBe(false);
    expect(result.blockingEvents).toEqual([]);
  });

  it('still requires a scheduled match when closing via NEXT_MATCH', async () => {
    career.currentDate = '2026-12-31';
    fixturesRepository.find.mockResolvedValue([]);
    eventQueueService.findBlockingEvents.mockResolvedValue([
      createEventResponse(
        20,
        career.currentDate,
        true,
        CalendarEventStatus.READY,
      ),
    ]);
    eventQueueService.canAdvancePastTransferWindowClose.mockResolvedValue(true);
    await expect(
      service.advance(7, career.id, {
        mode: CalendarAdvanceMode.NEXT_MATCH,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(career.currentDate).toBe('2026-12-31');
  });

  it('does not expose another account career', async () => {
    careersRepository.findOneBy.mockResolvedValue(null);

    await expect(service.findOne(8, career.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('shows annual metadata without mutating a legacy save on GET', async () => {
    const result = await service.findOne(7, career.id);
    expect(result.autoSchedule).toBe(false);
    expect(result.season.currentPhase.code).toBe('PRESEASON');
    expect(result.season.periods).toHaveLength(14);
    expect(seasonScheduleService.prepare).not.toHaveBeenCalled();
    expect(entityManager.save).not.toHaveBeenCalled();
  });

  it('enables automatic league scheduling only on explicit start', async () => {
    const result = await service.startSeason(7, career.id);
    expect(result.autoSchedule).toBe(true);
    expect(result.currentDate).toBe('2026-01-01');
    expect(seasonScheduleService.prepare).toHaveBeenCalledWith(
      entityManager,
      career,
    );
    expect(eventQueueService.processThroughDate).not.toHaveBeenCalled();
  });

  it('keeps season-start ownership checks inside the career lock', async () => {
    entityManager.findOne.mockResolvedValue(null);
    await expect(service.startSeason(8, career.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(seasonScheduleService.prepare).not.toHaveBeenCalled();
  });

  it('stops NEXT_EVENT at a season boundary when the event queue is empty', async () => {
    fixturesRepository.find.mockResolvedValue([]);
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.NEXT_EVENT,
    });
    expect(result.currentDate).toBe('2026-01-12');
    expect(result.stopReason).toBe(CalendarStopReason.SEASON_BOUNDARY);
  });

  it('does not skip the summer split boundary when advancing three days', async () => {
    career.currentDate = '2026-07-28';
    fixturesRepository.find.mockResolvedValue([]);
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.THREE_DAYS,
    });
    expect(result.currentDate).toBe('2026-07-29');
    expect(result.season.currentPhase.code).toBe('SPLIT_3');
    expect(result.stopReason).toBe(CalendarStopReason.SEASON_BOUNDARY);
  });

  it('refreshes fixtures after automatic provisioning and retains match-day priority', async () => {
    career.autoSchedule = true;
    career.currentDate = '2026-01-11';
    fixturesRepository.find.mockResolvedValue([]);
    seasonScheduleService.prepare.mockImplementation(
      (_manager: unknown, datedCareer: Career) => {
        if (datedCareer.currentDate === '2026-01-12')
          fixturesRepository.find.mockResolvedValue([fixture]);
      },
    );
    const result = await service.advance(7, career.id, {
      mode: CalendarAdvanceMode.THREE_DAYS,
    });
    expect(result.currentDate).toBe('2026-01-12');
    expect(result.dueMatches[0].id).toBe(fixture.id);
    expect(result.stopReason).toBe(CalendarStopReason.MATCH_DAY);
  });

  it('preserves a late legacy fixture and exposes its schedule warning', async () => {
    fixture.scheduledDate = '2026-03-19';
    const result = await service.findOne(7, career.id);
    expect(result.nextMatch?.scheduledDate).toBe('2026-03-19');
    expect(result.scheduleWarnings[0]).toMatchObject({
      fixtureId: fixture.id,
      expectedEndDate: '2026-03-08',
    });
    expect(entityManager.save).not.toHaveBeenCalled();
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
