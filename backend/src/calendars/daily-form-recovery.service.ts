import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { FORM_RECOVERY_CONFIG } from '../careers/config/form-recovery';
import { PLAYER_CARD_STAT_MAX } from '../players/constants/player-card.constants';

@Injectable()
export class DailyFormRecoveryService {
  // Only on actual date advancement, inside the locked career transaction.
  // One indexed bulk update per day, not a SELECT/save loop over every player.
  async apply(
    manager: EntityManager,
    careerId: number,
    date: string,
  ): Promise<void> {
    const { ceiling, slowestDays, fastestDays } = FORM_RECOVERY_CONFIG.passive;
    const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
    await manager
      .createQueryBuilder()
      .update(CareerPlayer)
      .set({ form: () => 'form + 1' })
      .where('careerId = :careerId AND form < :ceiling', { careerId, ceiling })
      // Stable game-date cadence; batching days or reloading grants no extra recovery.
      .andWhere(
        'MOD(:day + id, ROUND(:slowest - :range * POWER(LEAST(:mentalMax, GREATEST(0, currentMental)) / :mentalMax, 2))) = 0',
        {
          day,
          slowest: slowestDays,
          range: slowestDays - fastestDays,
          mentalMax: PLAYER_CARD_STAT_MAX,
        },
      )
      .execute();
  }
}
