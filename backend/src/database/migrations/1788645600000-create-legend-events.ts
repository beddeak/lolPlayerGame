import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

const PREVIOUS_EVENT_TYPES = [
  'SCHEDULED_GAME',
  'CONTRACT_RESPONSE',
  'CONTRACT_EXPIRATION',
  'LEGEND_REVEAL',
  'PLAYER_MEETING',
  'INTERNATIONAL_ROSTER_REGISTRATION',
  'SEASON_REVIEW',
  'TRANSFER_WINDOW_OPEN',
];
const EVENT_TYPES = [
  ...PREVIOUS_EVENT_TYPES.slice(0, 4),
  'LEGEND_SIGNING',
  ...PREVIOUS_EVENT_TYPES.slice(4),
];
const idColumn = () => ({
  name: 'id',
  type: 'int',
  unsigned: true,
  isPrimary: true,
  isGenerated: true,
  generationStrategy: 'increment' as const,
});
const foreignKey = (
  name: string,
  column: string,
  table: string,
  onDelete = 'CASCADE',
) => ({
  name,
  columnNames: [column],
  referencedTableName: table,
  referencedColumnNames: ['id'],
  onDelete,
});

export class CreateLegendEvents1788645600000 implements MigrationInterface {
  name = 'CreateLegendEvents1788645600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'themes',
      new TableColumn({
        name: 'legendEnabled',
        type: 'boolean',
        default: false,
      }),
    );
    await this.changeEventType(queryRunner, EVENT_TYPES);
    await queryRunner.createTable(
      new Table({
        name: 'legend_seasons',
        columns: [
          idColumn(),
          { name: 'careerId', type: 'int', unsigned: true },
          { name: 'year', type: 'smallint', unsigned: true },
          { name: 'seed', type: 'varchar', length: '64' },
          { name: 'eventCount', type: 'tinyint', unsigned: true },
          { name: 'zeroEventStreak', type: 'smallint', unsigned: true },
        ],
        uniques: [
          {
            name: 'UQ_legend_seasons_career_year',
            columnNames: ['careerId', 'year'],
          },
        ],
        indices: [
          { name: 'IDX_legend_seasons_career_id', columnNames: ['careerId'] },
        ],
        foreignKeys: [
          foreignKey('FK_legend_seasons_career', 'careerId', 'careers'),
        ],
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'legend_events',
        columns: [
          idColumn(),
          { name: 'careerId', type: 'int', unsigned: true },
          { name: 'seasonId', type: 'int', unsigned: true },
          { name: 'ordinal', type: 'tinyint', unsigned: true },
          { name: 'themeId', type: 'int', unsigned: true },
          { name: 'playerCardIds', type: 'json' },
          { name: 'revealDate', type: 'date' },
          { name: 'revealedDate', type: 'date', isNullable: true },
          {
            name: 'calendarEventId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
        ],
        uniques: [
          {
            name: 'UQ_legend_events_season_ordinal',
            columnNames: ['seasonId', 'ordinal'],
          },
          {
            name: 'UQ_legend_events_calendar_event',
            columnNames: ['calendarEventId'],
          },
        ],
        indices: [
          { name: 'IDX_legend_events_career_id', columnNames: ['careerId'] },
          { name: 'IDX_legend_events_season_id', columnNames: ['seasonId'] },
          { name: 'IDX_legend_events_theme_id', columnNames: ['themeId'] },
          {
            name: 'IDX_legend_events_reveal_date',
            columnNames: ['revealDate'],
          },
        ],
        foreignKeys: [
          foreignKey('FK_legend_events_career', 'careerId', 'careers'),
          foreignKey('FK_legend_events_season', 'seasonId', 'legend_seasons'),
          foreignKey('FK_legend_events_theme', 'themeId', 'themes', 'RESTRICT'),
          foreignKey(
            'FK_legend_events_calendar_event',
            'calendarEventId',
            'calendar_events',
            'SET NULL',
          ),
        ],
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'legend_event_players',
        columns: [
          idColumn(),
          { name: 'careerId', type: 'int', unsigned: true },
          { name: 'legendEventId', type: 'int', unsigned: true },
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          { name: 'interestedTeamIds', type: 'json' },
          { name: 'aiDecisionDate', type: 'date' },
          { name: 'aiProcessedDate', type: 'date', isNullable: true },
        ],
        uniques: [
          {
            name: 'UQ_legend_event_players_career_player',
            columnNames: ['careerPlayerId'],
          },
        ],
        indices: [
          {
            name: 'IDX_legend_event_players_career_id',
            columnNames: ['careerId'],
          },
          {
            name: 'IDX_legend_event_players_event_id',
            columnNames: ['legendEventId'],
          },
          {
            name: 'IDX_legend_event_players_ai_date',
            columnNames: ['aiDecisionDate'],
          },
        ],
        foreignKeys: [
          foreignKey('FK_legend_event_players_career', 'careerId', 'careers'),
          foreignKey(
            'FK_legend_event_players_event',
            'legendEventId',
            'legend_events',
          ),
          foreignKey(
            'FK_legend_event_players_player',
            'careerPlayerId',
            'career_players',
          ),
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM calendar_events WHERE type = 'LEGEND_SIGNING'",
    );
    await queryRunner.query(
      'DELETE calendar_events FROM calendar_events INNER JOIN legend_events ON legend_events.calendarEventId = calendar_events.id',
    );
    await queryRunner.dropTable('legend_event_players');
    await queryRunner.dropTable('legend_events');
    await queryRunner.dropTable('legend_seasons');
    await queryRunner.dropColumn('themes', 'legendEnabled');
    await this.changeEventType(queryRunner, PREVIOUS_EVENT_TYPES);
  }

  private async changeEventType(
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
