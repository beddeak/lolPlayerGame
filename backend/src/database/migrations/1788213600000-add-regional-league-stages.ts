import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddRegionalLeagueStages1788213600000 implements MigrationInterface {
  name = 'AddRegionalLeagueStages1788213600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'match_series',
      new TableColumn({
        name: 'bestOf',
        type: 'tinyint',
        unsigned: true,
        default: 3,
      }),
    );
    await queryRunner.addColumn(
      'league_splits',
      new TableColumn({
        name: 'region',
        type: 'enum',
        enum: ['LCK', 'LPL', 'LEC', 'LCS'],
        default: "'LCK'",
      }),
    );
    await queryRunner.dropIndex(
      'league_splits',
      'UQ_league_splits_career_year_number',
    );
    await queryRunner.createIndex(
      'league_splits',
      new TableIndex({
        name: 'UQ_league_splits_career_year_region_number',
        columnNames: ['careerId', 'year', 'region', 'splitNumber'],
        isUnique: true,
      }),
    );
    await queryRunner.query(
      'ALTER TABLE league_splits ALTER COLUMN region DROP DEFAULT',
    );

    await queryRunner.createTable(
      new Table({
        name: 'league_stages',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'leagueSplitId', type: 'int', unsigned: true },
          { name: 'sequence', type: 'tinyint', unsigned: true },
          { name: 'code', type: 'varchar', length: '64' },
          { name: 'name', type: 'varchar', length: '100' },
          {
            name: 'format',
            type: 'enum',
            enum: [
              'ROUND_ROBIN',
              'GROUP',
              'SWISS',
              'PLAY_IN',
              'SINGLE_ELIMINATION',
              'DOUBLE_ELIMINATION',
              'GAUNTLET',
            ],
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['PLANNED', 'ACTIVE', 'COMPLETED'],
          },
          { name: 'bestOf', type: 'tinyint', unsigned: true },
          {
            name: 'currentRound',
            type: 'smallint',
            unsigned: true,
            default: 1,
          },
          { name: 'settings', type: 'json' },
        ],
        indices: [
          {
            name: 'IDX_league_stages_split_id',
            columnNames: ['leagueSplitId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_league_stages_split_sequence',
            columnNames: ['leagueSplitId', 'sequence'],
          },
          {
            name: 'UQ_league_stages_split_code',
            columnNames: ['leagueSplitId', 'code'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_league_stages_split',
            columnNames: ['leagueSplitId'],
            referencedTableName: 'league_splits',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'league_stage_participants',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'leagueStageId', type: 'int', unsigned: true },
          { name: 'careerTeamId', type: 'int', unsigned: true },
          { name: 'initialSeed', type: 'smallint', unsigned: true },
          {
            name: 'groupCode',
            type: 'varchar',
            length: '32',
            isNullable: true,
          },
        ],
        indices: [
          {
            name: 'IDX_league_stage_participants_stage_id',
            columnNames: ['leagueStageId'],
          },
          {
            name: 'IDX_league_stage_participants_team_id',
            columnNames: ['careerTeamId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_league_stage_participants_stage_team',
            columnNames: ['leagueStageId', 'careerTeamId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_league_stage_participants_stage',
            columnNames: ['leagueStageId'],
            referencedTableName: 'league_stages',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_league_stage_participants_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.addColumns('league_fixtures', [
      new TableColumn({
        name: 'leagueStageId',
        type: 'int',
        unsigned: true,
        isNullable: true,
      }),
      new TableColumn({
        name: 'stageFixtureNumber',
        type: 'smallint',
        unsigned: true,
        isNullable: true,
      }),
      new TableColumn({
        name: 'bestOf',
        type: 'tinyint',
        unsigned: true,
        default: 3,
      }),
    ]);

    await queryRunner.query(`
      INSERT INTO league_stages
        (leagueSplitId, sequence, code, name, format, status, bestOf, currentRound, settings)
      SELECT
        id, 1, 'REGULAR_SEASON', 'Regular Season', 'ROUND_ROBIN', 'ACTIVE', 3, 1,
        JSON_OBJECT('cycles', 2)
      FROM league_splits
    `);
    await queryRunner.query(`
      UPDATE league_fixtures fixture
      INNER JOIN league_stages stage
        ON stage.leagueSplitId = fixture.leagueSplitId
       AND stage.sequence = 1
      SET fixture.leagueStageId = stage.id,
          fixture.stageFixtureNumber = fixture.fixtureNumber
    `);
    await queryRunner.query(`
      INSERT INTO league_stage_participants
        (leagueStageId, careerTeamId, initialSeed, groupCode)
      SELECT
        seeded.leagueStageId,
        seeded.careerTeamId,
        ROW_NUMBER() OVER (
          PARTITION BY seeded.leagueStageId
          ORDER BY seeded.careerTeamId
        ),
        NULL
      FROM (
        SELECT DISTINCT stage.id AS leagueStageId, fixture.teamAId AS careerTeamId
        FROM league_stages stage
        INNER JOIN league_fixtures fixture
          ON fixture.leagueSplitId = stage.leagueSplitId
        UNION
        SELECT DISTINCT stage.id AS leagueStageId, fixture.teamBId AS careerTeamId
        FROM league_stages stage
        INNER JOIN league_fixtures fixture
          ON fixture.leagueSplitId = stage.leagueSplitId
      ) seeded
    `);

    await queryRunner.changeColumn(
      'league_fixtures',
      'leagueStageId',
      new TableColumn({
        name: 'leagueStageId',
        type: 'int',
        unsigned: true,
      }),
    );
    await queryRunner.changeColumn(
      'league_fixtures',
      'stageFixtureNumber',
      new TableColumn({
        name: 'stageFixtureNumber',
        type: 'smallint',
        unsigned: true,
      }),
    );
    await queryRunner.createIndex(
      'league_fixtures',
      new TableIndex({
        name: 'IDX_league_fixtures_stage_id',
        columnNames: ['leagueStageId'],
      }),
    );
    await queryRunner.createIndex(
      'league_fixtures',
      new TableIndex({
        name: 'UQ_league_fixtures_stage_number',
        columnNames: ['leagueStageId', 'stageFixtureNumber'],
        isUnique: true,
      }),
    );
    await queryRunner.createForeignKey(
      'league_fixtures',
      new TableForeignKey({
        name: 'FK_league_fixtures_stage',
        columnNames: ['leagueStageId'],
        referencedTableName: 'league_stages',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey(
      'league_fixtures',
      'FK_league_fixtures_stage',
    );
    await queryRunner.dropIndex(
      'league_fixtures',
      'UQ_league_fixtures_stage_number',
    );
    await queryRunner.dropIndex(
      'league_fixtures',
      'IDX_league_fixtures_stage_id',
    );
    await queryRunner.dropColumns('league_fixtures', [
      'bestOf',
      'stageFixtureNumber',
      'leagueStageId',
    ]);
    await queryRunner.dropTable('league_stage_participants');
    await queryRunner.dropTable('league_stages');
    await queryRunner.dropIndex(
      'league_splits',
      'UQ_league_splits_career_year_region_number',
    );
    await queryRunner.createIndex(
      'league_splits',
      new TableIndex({
        name: 'UQ_league_splits_career_year_number',
        columnNames: ['careerId', 'year', 'splitNumber'],
        isUnique: true,
      }),
    );
    await queryRunner.dropColumn('league_splits', 'region');
    await queryRunner.dropColumn('match_series', 'bestOf');
  }
}
