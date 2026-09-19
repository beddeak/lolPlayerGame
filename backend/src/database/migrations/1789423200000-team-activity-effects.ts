import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeamActivityEffects1789423200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE training_sessions ADD playerEffects json NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      'SELECT id FROM training_sessions WHERE playerEffects IS NOT NULL LIMIT 1',
    )) as { id: number }[];
    if (rows.length)
      throw new Error('Cannot remove saved team activity recovery history');
    await queryRunner.query(
      'ALTER TABLE training_sessions DROP COLUMN playerEffects',
    );
  }
}
