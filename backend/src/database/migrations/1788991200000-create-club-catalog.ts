import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { Region } from '../../careers/enums/region.enum';
import { RosterRole } from '../../careers/enums/roster-role.enum';
import { Position } from '../../players/enums/position.enum';

export class CreateClubCatalog1788991200000 implements MigrationInterface {
  name = 'CreateClubCatalog1788991200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'club_catalog',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'code', type: 'varchar', length: '32' },
          { name: 'name', type: 'varchar', length: '100' },
          { name: 'region', type: 'enum', enum: Object.values(Region) },
          { name: 'logoUrl', type: 'varchar', length: '500', isNullable: true },
          { name: 'enabled', type: 'tinyint', default: 1 },
          {
            name: 'initialChemistry',
            type: 'tinyint',
            unsigned: true,
            isNullable: true,
          },
        ],
        uniques: [{ name: 'UQ_club_catalog_code', columnNames: ['code'] }],
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'club_roster_templates',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'clubId', type: 'int', unsigned: true },
          { name: 'playerCardId', type: 'int', unsigned: true },
          { name: 'role', type: 'enum', enum: Object.values(RosterRole) },
          {
            name: 'position',
            type: 'enum',
            enum: Object.values(Position),
            isNullable: true,
          },
          {
            name: 'championArchetype',
            type: 'enum',
            enum: Object.values(ChampionArchetype),
            isNullable: true,
          },
          {
            name: 'initialCoachTrust',
            type: 'tinyint',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'initialForm',
            type: 'tinyint',
            unsigned: true,
            isNullable: true,
          },
        ],
        uniques: [
          {
            name: 'UQ_club_roster_templates_club_card',
            columnNames: ['clubId', 'playerCardId'],
          },
          {
            name: 'UQ_club_roster_templates_club_position',
            columnNames: ['clubId', 'position'],
          },
        ],
        indices: [
          {
            name: 'IDX_club_roster_templates_club_id',
            columnNames: ['clubId'],
          },
          {
            name: 'IDX_club_roster_templates_player_card_id',
            columnNames: ['playerCardId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_club_roster_templates_club',
            columnNames: ['clubId'],
            referencedTableName: 'club_catalog',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_club_roster_templates_player_card',
            columnNames: ['playerCardId'],
            referencedTableName: 'player_cards',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
        ],
      }),
    );
    await queryRunner.addColumns('career_teams', [
      new TableColumn({
        name: 'clubCode',
        type: 'varchar',
        length: '32',
        isNullable: true,
      }),
      new TableColumn({
        name: 'logoUrl',
        type: 'varchar',
        length: '500',
        isNullable: true,
      }),
    ]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('career_teams', 'logoUrl');
    await queryRunner.dropColumn('career_teams', 'clubCode');
    await queryRunner.dropTable('club_roster_templates');
    await queryRunner.dropTable('club_catalog');
  }
}
