import { ConflictException, NotFoundException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { ManagerCareerState } from './entities/manager-career-state.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';

const expectedManagerTeam = new AsyncLocalStorage<{
  careerId: number;
  teamId: number;
}>();

/** Carry ownership across a simulation's separate Career transactions. */
export function withExpectedManagerTeam<T>(
  careerId: number,
  teamId: number,
  action: () => Promise<T>,
): Promise<T> {
  return expectedManagerTeam.run({ careerId, teamId }, action);
}

/** Call only after taking the Career write lock in the current transaction. */
export async function assertManagerActive(
  manager: EntityManager,
  careerId: number,
): Promise<void> {
  const state = await manager.findOne(ManagerCareerState, {
    where: { careerId },
  });
  if (state?.status === 'DISMISSED') {
    throw new ConflictException(
      '경질된 감독은 구단을 운영할 수 없습니다. 기존 커리어 기록은 계속 확인할 수 있습니다.',
    );
  }
  const expected = expectedManagerTeam.getStore();
  if (expected?.careerId === careerId) {
    const teamId =
      state?.careerTeamId ??
      (
        await manager.findOne(CareerTeam, {
          where: { careerId, isUserControlled: true },
        })
      )?.id;
    if (teamId !== expected.teamId)
      throw new ConflictException(
        '감독 소속 구단이 변경되어 진행 중이던 시뮬레이션을 중단했습니다. 새 구단에서 다시 진행하세요.',
      );
  }
}

/** Serialize manager actions with calendar, contract and employment decisions. */
export async function lockActiveManagerCareer(
  manager: EntityManager,
  accountId: number,
  careerId: number,
): Promise<Career> {
  const career = await manager.findOne(Career, {
    where: { id: careerId, accountId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!career) {
    throw new NotFoundException(`Career ${careerId} was not found`);
  }
  await assertManagerActive(manager, careerId);
  return career;
}

/** Public current stats only; vacant starting positions count as zero. */
export async function getManagedLineupStrength(
  manager: EntityManager,
  careerId: number,
): Promise<number> {
  const starters = await manager.find(Roster, {
    where: {
      role: RosterRole.STARTER,
      careerTeam: { careerId, isUserControlled: true },
    },
    relations: { careerPlayer: true },
  });
  return (
    STARTER_POSITIONS.reduce((total, position) => {
      const player = starters.find(
        (roster) => roster.starterPosition === position,
      )?.careerPlayer;
      if (!player) return total;
      return (
        total +
        (player.currentMechanics +
          player.currentGameSense +
          player.currentLaning +
          player.currentTeamFight +
          player.currentMacro +
          player.currentTeamPlay +
          player.currentMental +
          player.currentChampionPool) /
          8
      );
    }, 0) / STARTER_POSITIONS.length
  );
}
