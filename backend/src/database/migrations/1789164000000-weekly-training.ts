import { MigrationInterface, QueryRunner } from 'typeorm';

export class WeeklyTraining1789164000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE training_periods ADD weekStartsAt date NULL, ADD UNIQUE INDEX UQ_training_periods_career_week (careerId, weekStartsAt)',
    );
    await queryRunner.query(
      "ALTER TABLE training_sessions MODIFY type enum('STRATEGY','CHEMISTRY','LANING','CHAMPION_POOL','ROLE','POSITION','MECHANICS','GAME_SENSE','TEAM_FIGHT','MACRO','TEAM_PLAY','MENTAL','REST') NOT NULL",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      "SELECT COUNT(*) AS count FROM training_sessions WHERE type NOT IN ('STRATEGY','CHEMISTRY','LANING','CHAMPION_POOL','ROLE','POSITION')",
    )) as { count: string }[];
    if (Number(rows[0].count) > 0)
      throw new Error(
        'Cannot remove weekly training while new activity records exist',
      );
    await queryRunner.query(
      "ALTER TABLE training_sessions MODIFY type enum('STRATEGY','CHEMISTRY','LANING','CHAMPION_POOL','ROLE','POSITION') NOT NULL",
    );
    await queryRunner.query(
      'ALTER TABLE training_periods DROP INDEX UQ_training_periods_career_week, DROP COLUMN weekStartsAt',
    );
  }
}
