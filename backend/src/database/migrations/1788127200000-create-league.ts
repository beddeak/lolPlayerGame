import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateLeague1788127200000 implements MigrationInterface {
  name = 'CreateLeague1788127200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'league_splits',
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
          { name: 'year', type: 'smallint', unsigned: true },
          { name: 'splitNumber', type: 'tinyint', unsigned: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_league_splits_career_id',
            columnNames: ['careerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_league_splits_career_year_number',
            columnNames: ['careerId', 'year', 'splitNumber'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_league_splits_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'league_fixtures',
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
          { name: 'fixtureNumber', type: 'smallint', unsigned: true },
          { name: 'roundNumber', type: 'smallint', unsigned: true },
          { name: 'teamAId', type: 'int', unsigned: true },
          { name: 'teamBId', type: 'int', unsigned: true },
          { name: 'seed', type: 'int', unsigned: true },
          {
            name: 'seriesId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
        ],
        indices: [
          {
            name: 'IDX_league_fixtures_split_id',
            columnNames: ['leagueSplitId'],
          },
          {
            name: 'IDX_league_fixtures_team_a_id',
            columnNames: ['teamAId'],
          },
          {
            name: 'IDX_league_fixtures_team_b_id',
            columnNames: ['teamBId'],
          },
          {
            name: 'IDX_league_fixtures_series_id',
            columnNames: ['seriesId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_league_fixtures_split_number',
            columnNames: ['leagueSplitId', 'fixtureNumber'],
          },
          {
            name: 'UQ_league_fixtures_series_id',
            columnNames: ['seriesId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_league_fixtures_split',
            columnNames: ['leagueSplitId'],
            referencedTableName: 'league_splits',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_league_fixtures_team_a',
            columnNames: ['teamAId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_league_fixtures_team_b',
            columnNames: ['teamBId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_league_fixtures_series',
            columnNames: ['seriesId'],
            referencedTableName: 'match_series',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('league_fixtures');
    await queryRunner.dropTable('league_splits');
  }
}
