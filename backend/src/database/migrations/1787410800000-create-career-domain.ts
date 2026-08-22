import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Region } from '../../careers/enums/region.enum';
import { RosterRole } from '../../careers/enums/roster-role.enum';
import { Position } from '../../players/enums/position.enum';

export class CreateCareerDomain1787410800000 implements MigrationInterface {
  name = 'CreateCareerDomain1787410800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'careers',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'startYear', type: 'smallint', unsigned: true },
          { name: 'currentYear', type: 'smallint', unsigned: true },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'career_teams',
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
          { name: 'code', type: 'varchar', length: '32' },
          { name: 'name', type: 'varchar', length: '100' },
          { name: 'region', type: 'enum', enum: Object.values(Region) },
          { name: 'isUserControlled', type: 'boolean', default: false },
        ],
        indices: [
          {
            name: 'IDX_career_teams_career_id',
            columnNames: ['careerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_career_teams_career_code',
            columnNames: ['careerId', 'code'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_career_teams_career',
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
        name: 'career_players',
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
          { name: 'playerCardId', type: 'int', unsigned: true },
          {
            name: 'currentTeamId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          { name: 'currentAge', type: 'tinyint', unsigned: true },
          {
            name: 'currentPosition',
            type: 'enum',
            enum: Object.values(Position),
          },
          { name: 'currentMechanics', type: 'tinyint', unsigned: true },
          { name: 'currentGameSense', type: 'tinyint', unsigned: true },
          { name: 'currentLaning', type: 'tinyint', unsigned: true },
          { name: 'currentTeamFight', type: 'tinyint', unsigned: true },
          { name: 'currentMacro', type: 'tinyint', unsigned: true },
          { name: 'currentTeamPlay', type: 'tinyint', unsigned: true },
          { name: 'currentMental', type: 'tinyint', unsigned: true },
          {
            name: 'currentChampionPool',
            type: 'tinyint',
            unsigned: true,
          },
        ],
        indices: [
          {
            name: 'IDX_career_players_career_id',
            columnNames: ['careerId'],
          },
          {
            name: 'IDX_career_players_player_card_id',
            columnNames: ['playerCardId'],
          },
          {
            name: 'IDX_career_players_current_team_id',
            columnNames: ['currentTeamId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_career_players_career_card',
            columnNames: ['careerId', 'playerCardId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_career_players_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_career_players_player_card',
            columnNames: ['playerCardId'],
            referencedTableName: 'player_cards',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
          {
            name: 'FK_career_players_current_team',
            columnNames: ['currentTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'rosters',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'careerTeamId', type: 'int', unsigned: true },
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          { name: 'role', type: 'enum', enum: Object.values(RosterRole) },
          {
            name: 'starterPosition',
            type: 'enum',
            enum: Object.values(Position),
            isNullable: true,
          },
        ],
        indices: [
          {
            name: 'IDX_rosters_career_team_id',
            columnNames: ['careerTeamId'],
          },
          {
            name: 'IDX_rosters_career_player_id',
            columnNames: ['careerPlayerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_rosters_career_player',
            columnNames: ['careerPlayerId'],
          },
          {
            name: 'UQ_rosters_team_starter_position',
            columnNames: ['careerTeamId', 'starterPosition'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_rosters_career_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_rosters_career_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('rosters');
    await queryRunner.dropTable('career_players');
    await queryRunner.dropTable('career_teams');
    await queryRunner.dropTable('careers');
  }
}
