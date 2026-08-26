import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateBo3MatchSeries1787781600000 implements MigrationInterface {
  name = 'CreateBo3MatchSeries1787781600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'match_series',
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
          { name: 'teamAId', type: 'int', unsigned: true },
          { name: 'teamBId', type: 'int', unsigned: true },
          { name: 'seed', type: 'int', unsigned: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          { name: 'IDX_match_series_career_id', columnNames: ['careerId'] },
          { name: 'IDX_match_series_team_a_id', columnNames: ['teamAId'] },
          { name: 'IDX_match_series_team_b_id', columnNames: ['teamBId'] },
        ],
        foreignKeys: [
          {
            name: 'FK_match_series_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_match_series_team_a',
            columnNames: ['teamAId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_match_series_team_b',
            columnNames: ['teamBId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.addColumns('matches', [
      new TableColumn({
        name: 'seriesId',
        type: 'int',
        unsigned: true,
        isNullable: true,
      }),
      new TableColumn({
        name: 'seriesGameNumber',
        type: 'tinyint',
        unsigned: true,
        isNullable: true,
      }),
    ]);
    await queryRunner.createIndex(
      'matches',
      new TableIndex({
        name: 'IDX_matches_series_id',
        columnNames: ['seriesId'],
      }),
    );
    await queryRunner.createIndex(
      'matches',
      new TableIndex({
        name: 'UQ_matches_series_game_number',
        columnNames: ['seriesId', 'seriesGameNumber'],
        isUnique: true,
      }),
    );
    await queryRunner.createForeignKey(
      'matches',
      new TableForeignKey({
        name: 'FK_matches_series',
        columnNames: ['seriesId'],
        referencedTableName: 'match_series',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('matches', 'FK_matches_series');
    await queryRunner.dropIndex('matches', 'UQ_matches_series_game_number');
    await queryRunner.dropIndex('matches', 'IDX_matches_series_id');
    await queryRunner.dropColumns('matches', ['seriesGameNumber', 'seriesId']);
    await queryRunner.dropTable('match_series');
  }
}
