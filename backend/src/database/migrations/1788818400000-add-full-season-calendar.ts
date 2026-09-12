import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddFullSeasonCalendar1788818400000 implements MigrationInterface {
  name = 'AddFullSeasonCalendar1788818400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'careers',
      new TableColumn({
        name: 'autoSchedule',
        type: 'tinyint',
        default: 0,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('careers', 'autoSchedule');
  }
}
