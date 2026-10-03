import { MigrationInterface, QueryRunner } from 'typeorm';

export class TacticalJsonText1789855200000 implements MigrationInterface {
  name = 'TacticalJsonText1789855200000';

  async up(runner: QueryRunner): Promise<void> {
    // Convert in place. Do not change existing hashes to disguise old corruption.
    await runner.query(
      'ALTER TABLE `match_tactical_runs` MODIFY COLUMN `input` longtext NULL, MODIFY COLUMN `draft` longtext NOT NULL, MODIFY COLUMN `manifest` longtext NULL',
    );
    await runner.query(
      'ALTER TABLE `match_tactical_chunks` MODIFY COLUMN `payload` longtext NOT NULL',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const existing: unknown = await runner.query(
      'SELECT id FROM `match_tactical_runs` LIMIT 1',
    );
    if (!Array.isArray(existing) || existing.length)
      throw new Error(
        'Cannot restore native JSON while tactical runs exist: number normalization could invalidate stored hashes.',
      );
    await runner.query(
      'ALTER TABLE `match_tactical_chunks` MODIFY COLUMN `payload` json NOT NULL',
    );
    await runner.query(
      'ALTER TABLE `match_tactical_runs` MODIFY COLUMN `input` json NULL, MODIFY COLUMN `draft` json NOT NULL, MODIFY COLUMN `manifest` json NULL',
    );
  }
}
