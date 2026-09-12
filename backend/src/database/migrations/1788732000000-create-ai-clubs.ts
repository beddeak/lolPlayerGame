import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

const PREVIOUS_EVENT_TYPES = [
  'SCHEDULED_GAME',
  'CONTRACT_RESPONSE',
  'CONTRACT_EXPIRATION',
  'LEGEND_REVEAL',
  'LEGEND_SIGNING',
  'PLAYER_MEETING',
  'INTERNATIONAL_ROSTER_REGISTRATION',
  'SEASON_REVIEW',
  'TRANSFER_WINDOW_OPEN',
];

export class CreateAiClubs1788732000000 implements MigrationInterface {
  name = 'CreateAiClubs1788732000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'ai_club_states',
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
            name: 'difficulty',
            type: 'enum',
            enum: ['EASY'],
            default: "'EASY'",
          },
          { name: 'budgetYear', type: 'smallint', unsigned: true },
          { name: 'annualSalaryBudget', type: 'int', unsigned: true },
          { name: 'transferBudget', type: 'int', unsigned: true },
          { name: 'transferSpent', type: 'int', unsigned: true, default: 0 },
          { name: 'lastDecisionDate', type: 'date', isNullable: true },
        ],
        uniques: [
          {
            name: 'UQ_ai_club_states_career_team',
            columnNames: ['careerTeamId'],
          },
        ],
        indices: [
          { name: 'IDX_ai_club_states_career_id', columnNames: ['careerId'] },
        ],
        foreignKeys: [
          {
            name: 'FK_ai_club_states_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_ai_club_states_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
    await this.changeEventTypes(queryRunner, [
      ...PREVIOUS_EVENT_TYPES,
      'AI_CLUB_UPDATE',
    ]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM calendar_events WHERE type = 'AI_CLUB_UPDATE'",
    );
    await this.changeEventTypes(queryRunner, PREVIOUS_EVENT_TYPES);
    await queryRunner.dropTable('ai_club_states');
  }

  private async changeEventTypes(
    queryRunner: QueryRunner,
    values: string[],
  ): Promise<void> {
    const table = await queryRunner.getTable('calendar_events');
    const column = table?.findColumnByName('type');
    if (!table || !column)
      throw new Error('calendar_events.type was not found');
    await queryRunner.changeColumn(
      table,
      column,
      new TableColumn({ name: 'type', type: 'enum', enum: values }),
    );
  }
}
