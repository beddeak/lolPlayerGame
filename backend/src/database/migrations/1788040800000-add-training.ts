import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { TrainingCategory } from '../../careers/enums/training-category.enum';
import { TrainingType } from '../../careers/enums/training-type.enum';
import { POSITION_PROFICIENCY_CONFIG } from '../../careers/config/position-proficiency.config';
import { Position } from '../../players/enums/position.enum';

export class AddTraining1788040800000 implements MigrationInterface {
  name = 'AddTraining1788040800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'career_player_position_proficiencies',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          { name: 'position', type: 'enum', enum: Object.values(Position) },
          { name: 'proficiency', type: 'tinyint', unsigned: true },
        ],
        indices: [
          {
            name: 'IDX_position_proficiencies_career_player_id',
            columnNames: ['careerPlayerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_position_proficiencies_player_position',
            columnNames: ['careerPlayerId', 'position'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_position_proficiencies_career_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    const positionRows = Object.values(Position)
      .map((position) => `SELECT '${position}' AS position`)
      .join(' UNION ALL ');

    await queryRunner.query(`
      INSERT INTO career_player_position_proficiencies
        (careerPlayerId, position, proficiency)
      SELECT
        careerPlayer.id,
        positions.position,
        CASE
          WHEN careerPlayer.currentPosition = positions.position
            THEN ${POSITION_PROFICIENCY_CONFIG.initialPrimary}
          ELSE ${POSITION_PROFICIENCY_CONFIG.initialSecondary}
        END
      FROM career_players careerPlayer
      CROSS JOIN (${positionRows}) positions
    `);

    await queryRunner.createTable(
      new Table({
        name: 'training_periods',
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
          { name: 'periodNumber', type: 'int', unsigned: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_training_periods_career_id',
            columnNames: ['careerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_training_periods_career_number',
            columnNames: ['careerId', 'periodNumber'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_training_periods_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.query(`
      INSERT INTO training_periods (careerId, periodNumber)
      SELECT career.id, 1
      FROM careers career
    `);

    await queryRunner.createTable(
      new Table({
        name: 'training_sessions',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'trainingPeriodId', type: 'int', unsigned: true },
          { name: 'careerTeamId', type: 'int', unsigned: true },
          {
            name: 'careerPlayerId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'category',
            type: 'enum',
            enum: Object.values(TrainingCategory),
          },
          {
            name: 'type',
            type: 'enum',
            enum: Object.values(TrainingType),
          },
          { name: 'categorySequence', type: 'tinyint', unsigned: true },
          {
            name: 'strategy',
            type: 'enum',
            enum: Object.values(TeamStrategy),
            isNullable: true,
          },
          {
            name: 'position',
            type: 'enum',
            enum: Object.values(Position),
            isNullable: true,
          },
          {
            name: 'instruction',
            type: 'enum',
            enum: Object.values(PlayerInstruction),
            isNullable: true,
          },
          { name: 'growthSucceeded', type: 'boolean', isNullable: true },
          { name: 'resultBefore', type: 'tinyint', unsigned: true },
          { name: 'resultDelta', type: 'tinyint' },
          { name: 'resultAfter', type: 'tinyint', unsigned: true },
          {
            name: 'conditionBefore',
            type: 'tinyint',
            unsigned: true,
            isNullable: true,
          },
          { name: 'conditionDelta', type: 'tinyint', isNullable: true },
          {
            name: 'conditionAfter',
            type: 'tinyint',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'formBefore',
            type: 'tinyint',
            unsigned: true,
            isNullable: true,
          },
          { name: 'formDelta', type: 'tinyint', isNullable: true },
          {
            name: 'formAfter',
            type: 'tinyint',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_training_sessions_period_id',
            columnNames: ['trainingPeriodId'],
          },
          {
            name: 'IDX_training_sessions_career_team_id',
            columnNames: ['careerTeamId'],
          },
          {
            name: 'IDX_training_sessions_career_player_id',
            columnNames: ['careerPlayerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_training_sessions_period_category_sequence',
            columnNames: ['trainingPeriodId', 'category', 'categorySequence'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_training_sessions_period',
            columnNames: ['trainingPeriodId'],
            referencedTableName: 'training_periods',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_training_sessions_career_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_training_sessions_career_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    await queryRunner.addColumn(
      'match_player_stats',
      new TableColumn({
        name: 'positionProficiency',
        type: 'tinyint',
        unsigned: true,
        default: POSITION_PROFICIENCY_CONFIG.initialPrimary,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('match_player_stats', 'positionProficiency');
    await queryRunner.dropTable('training_sessions');
    await queryRunner.dropTable('training_periods');
    await queryRunner.dropTable('career_player_position_proficiencies');
  }
}
