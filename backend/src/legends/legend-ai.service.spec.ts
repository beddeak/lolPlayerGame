import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { ContractsService } from '../contracts/contracts.service';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { CalendarEventStatus } from '../event-queue/enums/calendar-event-status.enum';
import { CalendarEventType } from '../event-queue/enums/calendar-event-type.enum';
import { LegendEventPlayer } from './entities/legend-event-player.entity';
import { LegendAiService } from './legend-ai.service';

describe('Legend event AI competition', () => {
  const career = { id: 1, currentDate: '2026-11-20' } as Career;
  const player = {
    id: 9,
    careerId: 1,
    playerCardId: 11,
    currentTeamId: null,
    playerCard: { cardYear: 2021, player: { nickname: 'Legend' } },
  } as CareerPlayer;
  const contracts = { signLegendFreeAgentForAi: jest.fn() };
  const service = new LegendAiService(contracts as unknown as ContractsService);
  beforeEach(() => jest.resetAllMocks());

  it('samples all regions deterministically, excludes the manager, and limits interest to four', async () => {
    const teams = Array.from({ length: 8 }, (_, i) => ({ id: i + 2 }));
    const manager = { find: jest.fn().mockResolvedValue(teams) };
    const first = await service.prepareInterests(
      manager as unknown as EntityManager,
      career,
      player,
      'a'.repeat(64),
      '2026-11-20',
    );
    const again = await service.prepareInterests(
      manager as unknown as EntityManager,
      career,
      player,
      'a'.repeat(64),
      '2026-11-20',
    );
    expect(first).toEqual(again);
    expect(first.interestedTeamIds).toHaveLength(4);
    expect(new Set(first.interestedTeamIds).size).toBe(4);
    expect(
      first.aiDecisionDate >= '2026-11-27' &&
        first.aiDecisionDate <= '2026-12-04',
    ).toBe(true);
    expect(manager.find).toHaveBeenCalledWith(
      CareerTeam,
      expect.objectContaining({
        where: { careerId: 1, isUserControlled: false },
      }),
    );
  });

  it('preserves reaction time for late reveals instead of an instant closing-day AI signing', async () => {
    const manager = { find: jest.fn().mockResolvedValue([]) };
    const result = await service.prepareInterests(
      manager as unknown as EntityManager,
      career,
      player,
      'b'.repeat(64),
      '2026-12-28',
    );
    expect(result.interestedTeamIds).toEqual([]);
    expect(result.aiDecisionDate >= '2027-01-04').toBe(true);
    expect(result.aiDecisionDate <= '2027-01-11').toBe(true);
  });

  function context(currentTeamId: number | null = null) {
    const entrant = {
      id: 3,
      careerId: 1,
      legendEventId: 2,
      careerPlayerId: player.id,
      interestedTeamIds: [2, 3],
      aiDecisionDate: '2026-11-28',
      aiProcessedDate: null,
    } as LegendEventPlayer;
    const manager = {
      find: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(entrant.aiProcessedDate ? [] : [entrant]),
        ),
      findOne: jest.fn().mockResolvedValue({ ...player, currentTeamId }),
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 3, code: 'AI3', name: 'AI Three' }),
      create: jest
        .fn()
        .mockImplementation((_entity: unknown, value: unknown) => value),
      save: jest
        .fn()
        .mockImplementation((_entity: unknown, value: unknown) =>
          Promise.resolve(value),
        ),
    };
    return { entrant, manager };
  }

  it('tries the persisted clubs in order and records one nonblocking signing, once', async () => {
    const { manager, entrant } = context();
    contracts.signLegendFreeAgentForAi
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = await service.processCompetition(
      manager as unknown as EntityManager,
      career,
      '2026-11-28',
    );
    expect(
      contracts.signLegendFreeAgentForAi.mock.calls.map(
        (call: unknown[]) => call[2],
      ),
    ).toEqual([2, 3]);
    expect(contracts.signLegendFreeAgentForAi).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ currentDate: '2026-11-28' }),
      3,
      player.id,
      expect.any(Object),
    );
    expect(result).toEqual([
      expect.objectContaining({
        type: CalendarEventType.LEGEND_SIGNING,
        status: CalendarEventStatus.COMPLETED,
        requiresUserAction: false,
        payload: expect.objectContaining({
          careerPlayerId: player.id,
          careerTeamId: 3,
          legendEventId: 2,
        }) as unknown,
      }),
    ]);
    expect(manager.save).toHaveBeenCalledWith(CalendarEvent, result[0]);
    expect(entrant.aiProcessedDate).toBe('2026-11-28');
    expect(
      await service.processCompetition(
        manager as unknown as EntityManager,
        career,
        '2026-11-29',
      ),
    ).toEqual([]);
    expect(contracts.signLegendFreeAgentForAi).toHaveBeenCalledTimes(2);
  });

  it.each(['owned', 'closed', 'all-refused'])(
    'consumes the one opportunity without signing when %s',
    async (reason) => {
      const { manager, entrant } = context(reason === 'owned' ? 1 : null);
      contracts.signLegendFreeAgentForAi.mockResolvedValue(false);
      expect(
        await service.processCompetition(
          manager as unknown as EntityManager,
          career,
          reason === 'closed' ? '2027-01-01' : '2026-11-28',
        ),
      ).toEqual([]);
      expect(entrant.aiProcessedDate).not.toBeNull();
      expect(contracts.signLegendFreeAgentForAi).toHaveBeenCalledTimes(
        reason === 'all-refused' ? 2 : 0,
      );
      expect(manager.save).not.toHaveBeenCalledWith(
        CalendarEvent,
        expect.anything(),
      );
    },
  );

  it('propagates unexpected failures so the parent transaction can roll back and retry', async () => {
    const { manager, entrant } = context();
    contracts.signLegendFreeAgentForAi.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(
      service.processCompetition(
        manager as unknown as EntityManager,
        career,
        '2026-11-28',
      ),
    ).rejects.toThrow('database unavailable');
    expect(entrant.aiProcessedDate).toBeNull();
    expect(manager.save).not.toHaveBeenCalled();
  });
});
