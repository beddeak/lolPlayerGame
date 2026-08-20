import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Position } from '../../players/enums/position.enum';

export class CreatePlayerCatalog1787237754573 implements MigrationInterface {
  name = 'CreatePlayerCatalog1787237754573';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'players',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'nickname', type: 'varchar', length: '50' },
          { name: 'nationality', type: 'varchar', length: '50' },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'themes',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'code', type: 'varchar', length: '64' },
          { name: 'name', type: 'varchar', length: '100' },
          {
            name: 'description',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
        ],
        uniques: [
          {
            name: 'UQ_themes_code',
            columnNames: ['code'],
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'player_cards',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'playerId', type: 'int', unsigned: true },
          { name: 'themeId', type: 'int', unsigned: true },
          { name: 'cardYear', type: 'smallint', unsigned: true },
          { name: 'startingAge', type: 'tinyint', unsigned: true },
          {
            name: 'mainPosition',
            type: 'enum',
            enum: Object.values(Position),
          },
          { name: 'mechanics', type: 'tinyint', unsigned: true },
          { name: 'gameSense', type: 'tinyint', unsigned: true },
          { name: 'laning', type: 'tinyint', unsigned: true },
          { name: 'teamFight', type: 'tinyint', unsigned: true },
          { name: 'macro', type: 'tinyint', unsigned: true },
          { name: 'teamPlay', type: 'tinyint', unsigned: true },
          { name: 'mental', type: 'tinyint', unsigned: true },
          { name: 'championPool', type: 'tinyint', unsigned: true },
          { name: 'potential', type: 'tinyint', unsigned: true },
        ],
        indices: [
          {
            name: 'IDX_player_cards_player_id',
            columnNames: ['playerId'],
          },
          {
            name: 'IDX_player_cards_theme_id',
            columnNames: ['themeId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_player_cards_player_theme_year',
            columnNames: ['playerId', 'themeId', 'cardYear'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_player_cards_player',
            columnNames: ['playerId'],
            referencedTableName: 'players',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
          {
            name: 'FK_player_cards_theme',
            columnNames: ['themeId'],
            referencedTableName: 'themes',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('player_cards');
    await queryRunner.dropTable('themes');
    await queryRunner.dropTable('players');
  }
}
