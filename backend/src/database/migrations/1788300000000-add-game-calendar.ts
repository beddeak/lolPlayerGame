import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class AddGameCalendar1788300000000 implements MigrationInterface {
  name = 'AddGameCalendar1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'careers',
      new TableColumn({ name: 'currentDate', type: 'date', isNullable: true }),
    );
    await queryRunner.query(`
      UPDATE careers
      SET currentDate = STR_TO_DATE(CONCAT(startYear, '-01-01'), '%Y-%m-%d')
    `);
    await queryRunner.changeColumn(
      'careers',
      'currentDate',
      new TableColumn({ name: 'currentDate', type: 'date' }),
    );

    await queryRunner.addColumn(
      'league_fixtures',
      new TableColumn({
        name: 'scheduledDate',
        type: 'date',
        isNullable: true,
      }),
    );
    await queryRunner.query(`
      UPDATE league_fixtures fixture
      INNER JOIN league_splits split ON split.id = fixture.leagueSplitId
      INNER JOIN league_stages stage ON stage.id = fixture.leagueStageId
      SET fixture.scheduledDate = DATE_ADD(
        CASE split.splitNumber
          WHEN 1 THEN STR_TO_DATE(CONCAT(split.year, '-01-12'), '%Y-%m-%d')
          WHEN 2 THEN STR_TO_DATE(CONCAT(split.year, '-03-30'), '%Y-%m-%d')
          ELSE STR_TO_DATE(CONCAT(split.year, '-07-20'), '%Y-%m-%d')
        END,
        INTERVAL (((stage.sequence - 1) * 28) + ((fixture.roundNumber - 1) * 3)) DAY
      )
    `);
    await queryRunner.changeColumn(
      'league_fixtures',
      'scheduledDate',
      new TableColumn({ name: 'scheduledDate', type: 'date' }),
    );
    await queryRunner.createIndex(
      'league_fixtures',
      new TableIndex({
        name: 'IDX_league_fixtures_scheduled_date',
        columnNames: ['scheduledDate'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'league_fixtures',
      'IDX_league_fixtures_scheduled_date',
    );
    await queryRunner.dropColumn('league_fixtures', 'scheduledDate');
    await queryRunner.dropColumn('careers', 'currentDate');
  }
}
