import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateCalendarEvents1788386400000 implements MigrationInterface {
  name = 'CreateCalendarEvents1788386400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'calendar_events',
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
          { name: 'scheduledDate', type: 'date' },
          {
            name: 'type',
            type: 'enum',
            enum: [
              'SCHEDULED_GAME',
              'CONTRACT_RESPONSE',
              'LEGEND_REVEAL',
              'PLAYER_MEETING',
              'INTERNATIONAL_ROSTER_REGISTRATION',
              'SEASON_REVIEW',
              'TRANSFER_WINDOW_OPEN',
            ],
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['SCHEDULED', 'READY', 'COMPLETED'],
            default: "'SCHEDULED'",
          },
          {
            name: 'requiresUserAction',
            type: 'boolean',
            default: false,
          },
          { name: 'payload', type: 'json', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'completedAt',
            type: 'timestamp',
            precision: 0,
            isNullable: true,
          },
        ],
        indices: [
          {
            name: 'IDX_calendar_events_career_date',
            columnNames: ['careerId', 'scheduledDate'],
          },
          {
            name: 'IDX_calendar_events_career_status',
            columnNames: ['careerId', 'status'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_calendar_events_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('calendar_events');
  }
}
