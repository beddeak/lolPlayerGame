import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdjustSplitThreeStart1788303600000 implements MigrationInterface {
  name = 'AdjustSplitThreeStart1788303600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE league_fixtures fixture
      INNER JOIN league_splits split ON split.id = fixture.leagueSplitId
      SET fixture.scheduledDate = DATE_ADD(fixture.scheduledDate, INTERVAL 9 DAY)
      WHERE split.splitNumber = 3
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE league_fixtures fixture
      INNER JOIN league_splits split ON split.id = fixture.leagueSplitId
      SET fixture.scheduledDate = DATE_SUB(fixture.scheduledDate, INTERVAL 9 DAY)
      WHERE split.splitNumber = 3
    `);
  }
}
