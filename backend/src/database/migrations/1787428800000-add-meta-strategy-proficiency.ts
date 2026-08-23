import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

const TEAM_STRATEGIES = [
  'BALANCED',
  'TOP_CARRY',
  'TOP_JUNGLE',
  'MID_CARRY',
  'MID_JUNGLE',
  'UPPER_SIDE',
  'BOT_CARRY',
  'BOT_PRESSURE',
];
const INITIAL_STRATEGY_PROFICIENCY = 50;

export class AddMetaStrategyProficiency1787428800000 implements MigrationInterface {
  name = 'AddMetaStrategyProficiency1787428800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'careers',
      new TableColumn({
        name: 'currentMeta',
        type: 'enum',
        enum: TEAM_STRATEGIES,
        default: "'BALANCED'",
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'career_team_strategy_proficiencies',
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
          { name: 'strategy', type: 'enum', enum: TEAM_STRATEGIES },
          { name: 'proficiency', type: 'tinyint', unsigned: true },
        ],
        indices: [
          {
            name: 'IDX_team_strategy_proficiencies_career_team_id',
            columnNames: ['careerTeamId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_team_strategy_proficiencies_team_strategy',
            columnNames: ['careerTeamId', 'strategy'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_team_strategy_proficiencies_career_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    for (const strategy of TEAM_STRATEGIES) {
      await queryRunner.query(
        `INSERT INTO career_team_strategy_proficiencies
          (careerTeamId, strategy, proficiency)
         SELECT id, ?, ?
         FROM career_teams`,
        [strategy, INITIAL_STRATEGY_PROFICIENCY],
      );
    }

    const matchColumns = [
      new TableColumn({
        name: 'teamAStrategyProficiency',
        type: 'tinyint',
        unsigned: true,
        default: INITIAL_STRATEGY_PROFICIENCY,
      }),
      new TableColumn({
        name: 'teamAStrategyProficiencyModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamAMetaModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamBStrategyProficiency',
        type: 'tinyint',
        unsigned: true,
        default: INITIAL_STRATEGY_PROFICIENCY,
      }),
      new TableColumn({
        name: 'teamBStrategyProficiencyModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamBMetaModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'currentMeta',
        type: 'enum',
        enum: TEAM_STRATEGIES,
        default: "'BALANCED'",
      }),
    ];

    for (const column of matchColumns) {
      await queryRunner.addColumn('matches', column);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('matches', 'currentMeta');
    await queryRunner.dropColumn('matches', 'teamBMetaModifier');
    await queryRunner.dropColumn('matches', 'teamBStrategyProficiencyModifier');
    await queryRunner.dropColumn('matches', 'teamBStrategyProficiency');
    await queryRunner.dropColumn('matches', 'teamAMetaModifier');
    await queryRunner.dropColumn('matches', 'teamAStrategyProficiencyModifier');
    await queryRunner.dropColumn('matches', 'teamAStrategyProficiency');
    await queryRunner.dropTable('career_team_strategy_proficiencies');
    await queryRunner.dropColumn('careers', 'currentMeta');
  }
}
