import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateManagerJobOffers1789509600000 implements MigrationInterface {
  name = 'CreateManagerJobOffers1789509600000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'manager_job_offers',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'careerId', type: 'int', unsigned: true },
          { name: 'seasonYear', type: 'smallint', unsigned: true },
          { name: 'fromCareerTeamId', type: 'int', unsigned: true },
          { name: 'toCareerTeamId', type: 'int', unsigned: true },
          {
            name: 'status',
            type: 'enum',
            enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'],
            default: "'PENDING'",
          },
          { name: 'offeredDate', type: 'date' },
          { name: 'expiresDate', type: 'date' },
          { name: 'resolvedDate', type: 'date', isNullable: true },
          { name: 'reason', type: 'varchar', length: '500' },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        uniques: [
          {
            name: 'UQ_manager_job_offers_season_team',
            columnNames: ['careerId', 'seasonYear', 'toCareerTeamId'],
          },
        ],
        indices: [
          {
            name: 'IDX_manager_job_offers_career_status',
            columnNames: ['careerId', 'status'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_manager_job_offer_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_manager_job_offer_from_team',
            columnNames: ['fromCareerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_manager_job_offer_to_team',
            columnNames: ['toCareerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('manager_job_offers');
  }
}
