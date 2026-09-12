import { NotFoundException } from '@nestjs/common';
import { Career } from '../careers/entities/career.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { Position } from '../players/enums/position.enum';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { LegendEventPlayer } from '../legends/entities/legend-event-player.entity';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { PlayerContract } from '../contracts/entities/player-contract.entity';
import { AiClubState } from './entities/ai-club-state.entity';
import { AiClubsService } from './ai-clubs.service';

describe('EASY AI club calendar orchestration', () => {
  function setup(date = '2026-11-19') {
    const career = Object.assign(new Career(), {
      id: 1,
      accountId: 7,
      currentDate: date,
    });
    const team = Object.assign(new CareerTeam(), {
      id: 2,
      careerId: 1,
      isUserControlled: false,
      code: 'AI',
      teamStrategy: TeamStrategy.BALANCED,
    });
    const state = Object.assign(new AiClubState(), {
      id: 1,
      careerTeamId: 2,
      lastDecisionDate: null,
    });
    const player = (id: number, position = Position.TOP, stat = 80) =>
      Object.assign(new CareerPlayer(), {
        id,
        currentTeamId: team.id,
        currentPosition: position,
        currentMechanics: stat,
        currentGameSense: stat,
        currentLaning: stat,
        currentTeamFight: stat,
        currentMacro: stat,
        currentTeamPlay: stat,
        currentMental: stat,
        currentChampionPool: stat,
        playerCard: { player: { nickname: `Player${id}` } },
      });
    const rosters: Roster[] = Object.values(Position).map((position, index) =>
      Object.assign(new Roster(), {
        id: index + 1,
        careerTeamId: team.id,
        role: RosterRole.STARTER,
        starterPosition: position,
        careerPlayerId: index + 1,
        careerPlayer: player(index + 1, position),
      }),
    );
    const candidates: CareerPlayer[] = [];
    const legends: LegendEventPlayer[] = [];
    const series: MatchSeries[] = [];
    const manager = {
      find: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === CareerTeam
            ? [team]
            : entity === Roster
              ? rosters
              : entity === CareerPlayer
                ? candidates
                : entity === MatchSeries
                  ? series
                  : [],
        ),
      ),
      findBy: jest.fn((entity: unknown) =>
        Promise.resolve(entity === LegendEventPlayer ? legends : []),
      ),
      findOneBy: jest.fn((entity: unknown) =>
        Promise.resolve(entity === Career ? career : null),
      ),
      create: jest.fn((_entity: unknown, value: object) => value),
      save: jest.fn((_entity: unknown, value: object) =>
        Promise.resolve(value),
      ),
    };
    const budgets = {
      getOrCreate: jest.fn().mockResolvedValue(state),
      summarize: jest.fn().mockResolvedValue({}),
    };
    const contracts = { createAiOffer: jest.fn().mockResolvedValue(null) };
    const service = new AiClubsService(
      { manager } as never,
      budgets as never,
      contracts as never,
    );
    return {
      service,
      manager,
      career,
      team,
      state,
      rosters,
      candidates,
      legends,
      series,
      budgets,
      contracts,
      player,
    };
  }

  it('keeps GET read-only and rejects other accounts before looking up AI state', async () => {
    const context = setup();
    await context.service.findAll(7, 1);
    expect(context.manager.save).not.toHaveBeenCalled();
    expect(context.budgets.getOrCreate).not.toHaveBeenCalled();
    context.manager.findOneBy.mockResolvedValue(null);
    await expect(context.service.findAll(8, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(context.contracts.createAiOffer).not.toHaveBeenCalled();
  });

  it('reviews weekly, not on every same-day reload, and asks only for AI teams', async () => {
    const context = setup();
    await context.service.processDay(
      context.manager as never,
      context.career,
      context.career.currentDate,
    );
    const calls = context.contracts.createAiOffer.mock.calls.length;
    expect(calls).toBe(1); // Initial starter renewal, no candidates.
    await context.service.processDay(
      context.manager as never,
      context.career,
      context.career.currentDate,
    );
    expect(context.contracts.createAiOffer).toHaveBeenCalledTimes(calls);
    expect(context.state.lastDecisionDate).toBe('2026-11-19');
    expect(context.manager.find).toHaveBeenCalledWith(
      CareerTeam,
      expect.objectContaining({
        where: { careerId: 1, isUserControlled: false },
      }),
    );
  });

  it('promotes a better same-position bench without changing player stats, once', async () => {
    const context = setup('2026-02-01');
    const reserve = context.player(9, Position.TOP, 90);
    const before = structuredClone(reserve);
    context.rosters.push(
      Object.assign(new Roster(), {
        id: 9,
        careerTeamId: 2,
        role: RosterRole.BENCH,
        starterPosition: null,
        careerPlayerId: 9,
        careerPlayer: reserve,
      }),
    );
    await context.service.processDay(
      context.manager as never,
      context.career,
      context.career.currentDate,
    );
    expect(context.rosters[0].role).toBe(RosterRole.BENCH);
    expect(context.rosters[5].starterPosition).toBe(Position.TOP);
    expect(reserve).toEqual(before);
    const saves = context.manager.save.mock.calls.filter(
      ([entity]) => entity === Roster,
    );
    expect(saves).toHaveLength(2);
    await context.service.processDay(
      context.manager as never,
      context.career,
      context.career.currentDate,
    );
    expect(
      context.manager.save.mock.calls.filter(([entity]) => entity === Roster),
    ).toHaveLength(2);
    expect(context.contracts.createAiOffer).not.toHaveBeenCalled();
    expect(context.manager.save).not.toHaveBeenCalledWith(
      CareerPlayer,
      expect.anything(),
    );
  });

  it('does not alter AI tactics or lineups during an unfinished series', async () => {
    const context = setup();
    context.series.push(
      Object.assign(new MatchSeries(), {
        teamAId: 2,
        teamBId: 3,
        bestOf: 3,
        games: [{ winnerTeamId: 2 }],
      }),
    );
    await context.service.processDay(
      context.manager as never,
      context.career,
      context.career.currentDate,
    );
    expect(context.manager.save).not.toHaveBeenCalled();
    expect(context.contracts.createAiOffer).not.toHaveBeenCalled();
  });

  it('excludes the user club and unprocessed or same-day legend entrants from normal recruitment', async () => {
    const context = setup();
    context.candidates.push(
      Object.assign(context.player(11, Position.TOP, 99), {
        currentTeamId: 1,
        currentTeam: { isUserControlled: true },
      }),
      Object.assign(context.player(12, Position.TOP, 98), {
        currentTeamId: null,
      }),
      Object.assign(context.player(13, Position.TOP, 97), {
        currentTeamId: null,
      }),
      Object.assign(context.player(14, Position.TOP, 96), {
        currentTeamId: null,
      }),
    );
    context.legends.push(
      Object.assign(new LegendEventPlayer(), {
        careerPlayerId: 12,
        aiProcessedDate: null,
      }),
      Object.assign(new LegendEventPlayer(), {
        careerPlayerId: 13,
        aiProcessedDate: context.career.currentDate,
      }),
    );
    await context.service.processDay(
      context.manager as never,
      context.career,
      context.career.currentDate,
    );
    const targets = (
      context.contracts.createAiOffer.mock.calls as unknown[][]
    ).map((args) => args[3]);
    expect(targets).toEqual([1, 14]);
  });

  it('does not mark a decision complete if acquisition storage fails', async () => {
    const context = setup();
    context.contracts.createAiOffer.mockRejectedValue(
      new Error('database failure'),
    );
    await expect(
      context.service.processDay(
        context.manager as never,
        context.career,
        context.career.currentDate,
      ),
    ).rejects.toThrow('database failure');
    expect(context.state.lastDecisionDate).toBeNull();
    expect(context.manager.save).not.toHaveBeenCalledWith(
      AiClubState,
      expect.anything(),
    );
    expect(context.manager.save).not.toHaveBeenCalledWith(
      CalendarEvent,
      expect.anything(),
    );
  });

  it('reviews an expiring actual contract before the transfer window opens', async () => {
    const context = setup('2028-10-20');
    context.manager.findBy.mockImplementation(
      (entity: unknown) =>
        Promise.resolve(
          entity === PlayerContract
            ? [
                Object.assign(new PlayerContract(), {
                  careerPlayerId: 1,
                  endDate: '2028-11-19',
                  terms: { annualSalary: 100000 },
                }),
              ]
            : [],
        ) as never,
    );
    await context.service.processDay(
      context.manager as never,
      context.career,
      context.career.currentDate,
    );
    expect(context.contracts.createAiOffer).toHaveBeenCalledTimes(1);
    expect(context.contracts.createAiOffer).toHaveBeenCalledWith(
      context.manager,
      context.career,
      2,
      1,
      expect.anything(),
    );
  });
});
