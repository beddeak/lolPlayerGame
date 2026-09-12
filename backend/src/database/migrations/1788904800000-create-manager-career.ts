import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

const PREVIOUS_EVENTS = [
  'SCHEDULED_GAME',
  'CONTRACT_RESPONSE',
  'CONTRACT_EXPIRATION',
  'LEGEND_REVEAL',
  'LEGEND_SIGNING',
  'PLAYER_MEETING',
  'INTERNATIONAL_ROSTER_REGISTRATION',
  'SEASON_REVIEW',
  'TRANSFER_WINDOW_OPEN',
  'AI_CLUB_UPDATE',
];
export class CreateManagerCareer1788904800000 implements MigrationInterface {
  name = 'CreateManagerCareer1788904800000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'manager_career_states',
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
          { name: 'careerTeamId', type: 'int', unsigned: true },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACTIVE', 'WARNING', 'DISMISSED'],
            default: "'ACTIVE'",
          },
          { name: 'fanApproval', type: 'double', default: 65 },
          { name: 'boardConfidence', type: 'double', default: 65 },
          { name: 'trackingStartedDate', type: 'date' },
          { name: 'reviewYear', type: 'smallint', unsigned: true },
          ...['played', 'wins', 'winningStreak', 'losingStreak'].map(
            (name) => ({ name, type: 'int', unsigned: true, default: 0 }),
          ),
          { name: 'expectedWins', type: 'double', default: 0 },
          {
            name: 'warningAtPlayed',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          { name: 'warnedDate', type: 'date', isNullable: true },
          { name: 'dismissedDate', type: 'date', isNullable: true },
        ],
        uniques: [
          {
            name: 'UQ_manager_career_states_career',
            columnNames: ['careerId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_manager_state_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_manager_state_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'manager_reviews',
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
          { name: 'sourceKey', type: 'varchar', length: '96' },
          {
            name: 'type',
            type: 'enum',
            enum: [
              'BASELINE',
              'EXPECTATION',
              'SERIES',
              'SPLIT',
              'TRANSFER',
              'SEASON',
              'WARNING',
              'RECOVERED',
              'DISMISSED',
            ],
          },
          { name: 'reviewedDate', type: 'date' },
          { name: 'title', type: 'varchar', length: '128' },
          { name: 'reason', type: 'varchar', length: '500' },
          { name: 'fanDelta', type: 'double', default: 0 },
          { name: 'boardDelta', type: 'double', default: 0 },
          { name: 'fanApproval', type: 'double' },
          { name: 'boardConfidence', type: 'double' },
          { name: 'payload', type: 'json', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        uniques: [
          {
            name: 'UQ_manager_reviews_source',
            columnNames: ['careerId', 'sourceKey'],
          },
        ],
        indices: [
          {
            name: 'IDX_manager_reviews_career_date',
            columnNames: ['careerId', 'reviewedDate'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_manager_reviews_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
    for (const name of ['managerLineupBefore', 'managerLineupAfter']) {
      await queryRunner.addColumn(
        'transfer_records',
        new TableColumn({ name, type: 'double', isNullable: true }),
      );
    }
    await queryRunner.changeColumn(
      'calendar_events',
      'type',
      new TableColumn({
        name: 'type',
        type: 'enum',
        enum: [
          ...PREVIOUS_EVENTS,
          'MANAGER_REVIEW',
          'JOB_SECURITY_WARNING',
          'MANAGER_DISMISSED',
        ],
      }),
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM calendar_events WHERE type IN ('MANAGER_REVIEW', 'JOB_SECURITY_WARNING', 'MANAGER_DISMISSED')",
    );
    await queryRunner.changeColumn(
      'calendar_events',
      'type',
      new TableColumn({ name: 'type', type: 'enum', enum: PREVIOUS_EVENTS }),
    );
    for (const name of ['managerLineupBefore', 'managerLineupAfter'])
      await queryRunner.dropColumn('transfer_records', name);
    await queryRunner.dropTable('manager_reviews');
    await queryRunner.dropTable('manager_career_states');
  }
}
