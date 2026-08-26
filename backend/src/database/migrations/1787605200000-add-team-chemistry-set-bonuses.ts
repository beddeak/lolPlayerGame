import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';
import { TEAM_CHEMISTRY_CONFIG } from '../../careers/config/team-chemistry.config';

export class AddTeamChemistrySetBonuses1787605200000 implements MigrationInterface {
  name = 'AddTeamChemistrySetBonuses1787605200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'career_teams',
      new TableColumn({
        name: 'chemistry',
        type: 'tinyint',
        unsigned: true,
        default: TEAM_CHEMISTRY_CONFIG.initial,
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'set_bonuses',
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
          {
            name: 'chemistryBonus',
            type: 'tinyint',
            unsigned: true,
            default: 0,
          },
          {
            name: 'laningBonus',
            type: 'tinyint',
            unsigned: true,
            default: 0,
          },
          {
            name: 'teamFightBonus',
            type: 'tinyint',
            unsigned: true,
            default: 0,
          },
          {
            name: 'macroBonus',
            type: 'tinyint',
            unsigned: true,
            default: 0,
          },
          {
            name: 'teamPlayBonus',
            type: 'tinyint',
            unsigned: true,
            default: 0,
          },
        ],
        uniques: [{ name: 'UQ_set_bonuses_code', columnNames: ['code'] }],
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'set_bonus_requirements',
        columns: [
          {
            name: 'setBonusId',
            type: 'int',
            unsigned: true,
            isPrimary: true,
          },
          {
            name: 'playerCardId',
            type: 'int',
            unsigned: true,
            isPrimary: true,
          },
        ],
        indices: [
          {
            name: 'IDX_set_bonus_requirements_player_card_id',
            columnNames: ['playerCardId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_set_bonus_requirements_set_bonus',
            columnNames: ['setBonusId'],
            referencedTableName: 'set_bonuses',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_set_bonus_requirements_player_card',
            columnNames: ['playerCardId'],
            referencedTableName: 'player_cards',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
        ],
      }),
    );

    const matchColumns = [
      new TableColumn({
        name: 'teamAChemistry',
        type: 'tinyint',
        unsigned: true,
        default: TEAM_CHEMISTRY_CONFIG.initial,
      }),
      new TableColumn({
        name: 'teamAEffectiveChemistry',
        type: 'tinyint',
        unsigned: true,
        default: TEAM_CHEMISTRY_CONFIG.initial,
      }),
      new TableColumn({
        name: 'teamAChemistryModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamASetBonusModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamAActiveSetBonuses',
        type: 'json',
        isNullable: true,
      }),
      new TableColumn({
        name: 'teamBChemistry',
        type: 'tinyint',
        unsigned: true,
        default: TEAM_CHEMISTRY_CONFIG.initial,
      }),
      new TableColumn({
        name: 'teamBEffectiveChemistry',
        type: 'tinyint',
        unsigned: true,
        default: TEAM_CHEMISTRY_CONFIG.initial,
      }),
      new TableColumn({
        name: 'teamBChemistryModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamBSetBonusModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamBActiveSetBonuses',
        type: 'json',
        isNullable: true,
      }),
    ];

    await queryRunner.addColumns('matches', matchColumns);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('matches', [
      'teamBActiveSetBonuses',
      'teamBSetBonusModifier',
      'teamBChemistryModifier',
      'teamBEffectiveChemistry',
      'teamBChemistry',
      'teamAActiveSetBonuses',
      'teamASetBonusModifier',
      'teamAChemistryModifier',
      'teamAEffectiveChemistry',
      'teamAChemistry',
    ]);
    await queryRunner.dropTable('set_bonus_requirements');
    await queryRunner.dropTable('set_bonuses');
    await queryRunner.dropColumn('career_teams', 'chemistry');
  }
}
