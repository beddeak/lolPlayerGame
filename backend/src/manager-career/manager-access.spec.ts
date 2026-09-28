import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { Roster } from '../careers/entities/roster.entity';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { ManagerCareerState } from './entities/manager-career-state.entity';
import { MatchTacticalRun } from '../matches/entities/match-tactical-run.entity';
import {
  assertManagerActive,
  getManagedLineupStrength,
  lockActiveManagerCareer,
  withExpectedManagerTeam,
  withTacticalExecution,
} from './manager-access';

describe('Manager mutation access', () => {
  it('stops a simulation after the manager changes clubs between transactions without leaking the guard to other requests', async () => {
    const state = { status: 'ACTIVE', careerTeamId: 10 };
    const manager = {
      findOne: jest.fn(() => Promise.resolve({ ...state })),
    } as unknown as EntityManager;
    await withExpectedManagerTeam(1, 10, async () => {
      await expect(assertManagerActive(manager, 1)).resolves.toBeUndefined();
      state.careerTeamId = 20;
      await expect(assertManagerActive(manager, 1)).rejects.toThrow(
        '소속 구단이 변경',
      );
      await expect(assertManagerActive(manager, 2)).resolves.toBeUndefined();
    });
    await expect(assertManagerActive(manager, 1)).resolves.toBeUndefined();
  });
  it.each([null, 'ACTIVE', 'WARNING'])(
    'allows legacy or employed state %s',
    async (status) => {
      const manager = {
        findOne: jest.fn().mockResolvedValue(status ? { status } : null),
      };
      await expect(
        assertManagerActive(manager as unknown as EntityManager, 1),
      ).resolves.toBeUndefined();
      expect(manager.findOne).toHaveBeenCalledWith(ManagerCareerState, {
        where: { careerId: 1 },
      });
    },
  );

  it('blocks dismissed employment', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue({ status: 'DISMISSED' }),
    };
    await expect(
      assertManagerActive(manager as unknown as EntityManager, 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('locks the owned career before reading employment', async () => {
    const career = { id: 1, accountId: 7 };
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(career)
        .mockResolvedValueOnce(null),
    };
    await expect(
      lockActiveManagerCareer(manager as unknown as EntityManager, 7, 1),
    ).resolves.toBe(career);
    expect(manager.findOne).toHaveBeenNthCalledWith(1, Career, {
      where: { id: 1, accountId: 7 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.findOne).toHaveBeenNthCalledWith(2, ManagerCareerState, {
      where: { careerId: 1 },
    });
  });

  it('hides the employment state of another account', async () => {
    const manager = { findOne: jest.fn().mockResolvedValue(null) };
    await expect(
      lockActiveManagerCareer(manager as unknown as EntityManager, 8, 1),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.findOne).toHaveBeenCalledTimes(1);
  });

  it.each(['RUNNING', 'FINISHED'])(
    'blocks career mutations while a %s game has not committed its match',
    async (status) => {
      const manager = {
        findOne: jest.fn(async (entity: unknown) =>
          entity === MatchTacticalRun
            ? { id: 45, executionKey: 'game-a', status }
            : null,
        ),
      };
      await expect(
        assertManagerActive(manager as unknown as EntityManager, 1),
      ).rejects.toThrow('경기 도중');
      expect(manager.findOne).toHaveBeenCalledWith(
        MatchTacticalRun,
        expect.objectContaining({
          where: expect.objectContaining({ careerId: 1 }),
          select: { id: true, executionKey: true },
        }),
      );
    },
  );

  it('permits only its own exact execution to resume or commit and isolates the scope from other requests', async () => {
    const manager = {
      findOne: jest.fn(async (entity: unknown, options: any) => {
        if (
          entity !== MatchTacticalRun ||
          options.where.executionKey?.value === 'game-a'
        )
          return null;
        return { id: 45, executionKey: 'game-a' };
      }),
    } as unknown as EntityManager;
    await expect(
      assertManagerActive(manager, 1, 'game-a'),
    ).resolves.toBeUndefined();
    await expect(assertManagerActive(manager, 1, 'game-b')).rejects.toThrow(
      '경기 도중',
    );
    await withTacticalExecution('game-a', async () => {
      await expect(assertManagerActive(manager, 1)).resolves.toBeUndefined();
      await expect(assertManagerActive(manager, 1, 'game-b')).rejects.toThrow(
        '경기 도중',
      );
    });
    await expect(assertManagerActive(manager, 1)).rejects.toThrow('경기 도중');
  });
});

describe('Managed transfer lineup snapshots', () => {
  const player = (ability: number): CareerPlayer =>
    ({
      currentMechanics: ability,
      currentGameSense: ability,
      currentLaning: ability,
      currentTeamFight: ability,
      currentMacro: ability,
      currentTeamPlay: ability,
      currentMental: ability,
      currentChampionPool: ability,
    }) as CareerPlayer;

  it('averages only current public stats across the five starting slots', async () => {
    const manager = {
      find: jest.fn().mockResolvedValue(
        STARTER_POSITIONS.map((position, index) => ({
          starterPosition: position,
          careerPlayer: player(70 + index * 5),
        })),
      ),
    };
    await expect(
      getManagedLineupStrength(manager as unknown as EntityManager, 3),
    ).resolves.toBe(80);
    expect(manager.find).toHaveBeenCalledWith(
      Roster,
      expect.objectContaining({
        where: {
          role: 'STARTER',
          careerTeam: { careerId: 3, isUserControlled: true },
        },
      }),
    );
  });

  it('counts vacant positions as zero instead of hiding the lost starter', async () => {
    const manager = {
      find: jest.fn().mockResolvedValue(
        STARTER_POSITIONS.slice(1).map((position) => ({
          starterPosition: position,
          careerPlayer: player(80),
        })),
      ),
    };
    await expect(
      getManagedLineupStrength(manager as unknown as EntityManager, 3),
    ).resolves.toBe(64);
  });
});
