import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { ManagerCareerState } from './entities/manager-career-state.entity';

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
