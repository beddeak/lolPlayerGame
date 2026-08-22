import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';
import { PlayerInstruction } from '../../careers/enums/player-instruction.enum';
import { Position } from '../../players/enums/position.enum';

const INITIAL_ROLE_PROFICIENCY = 50;

const INSTRUCTIONS_BY_POSITION: Array<{
  position: Position;
  instructions: PlayerInstruction[];
}> = [
  {
    position: Position.TOP,
    instructions: [
      PlayerInstruction.CARRY,
      PlayerInstruction.WEAK_SIDE,
      PlayerInstruction.SPLIT_PUSH,
      PlayerInstruction.TEAMFIGHT,
    ],
  },
  {
    position: Position.JUNGLE,
    instructions: [
      PlayerInstruction.PLAY_FOR_TOP,
      PlayerInstruction.PLAY_FOR_MID,
      PlayerInstruction.PLAY_FOR_BOT,
      PlayerInstruction.FARM_CARRY,
      PlayerInstruction.OBJECTIVE,
      PlayerInstruction.AGGRESSIVE_GANK,
    ],
  },
  {
    position: Position.MID,
    instructions: [
      PlayerInstruction.CARRY,
      PlayerInstruction.ROAM_TOP,
      PlayerInstruction.ROAM_BOT,
      PlayerInstruction.SUPPORT_JUNGLE,
      PlayerInstruction.SCALING,
    ],
  },
  {
    position: Position.ADC,
    instructions: [
      PlayerInstruction.HYPER_CARRY,
      PlayerInstruction.LANE_PRESSURE,
      PlayerInstruction.SAFE_FARM,
      PlayerInstruction.WEAK_SIDE,
    ],
  },
  {
    position: Position.SUPPORT,
    instructions: [
      PlayerInstruction.PROTECT_ADC,
      PlayerInstruction.ROAM_TOP,
      PlayerInstruction.ROAM_MID,
      PlayerInstruction.ROAM_UPPER,
      PlayerInstruction.ENGAGE,
      PlayerInstruction.UTILITY,
    ],
  },
];

export class AddPlayerInstructionRoleProficiency1787425200000 implements MigrationInterface {
  name = 'AddPlayerInstructionRoleProficiency1787425200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'rosters',
      new TableColumn({
        name: 'playerInstruction',
        type: 'enum',
        enum: Object.values(PlayerInstruction),
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'match_player_stats',
      new TableColumn({
        name: 'playerInstruction',
        type: 'enum',
        enum: Object.values(PlayerInstruction),
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'match_player_stats',
      new TableColumn({
        name: 'roleProficiency',
        type: 'tinyint',
        unsigned: true,
        isNullable: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'career_player_role_proficiencies',
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
          {
            name: 'position',
            type: 'enum',
            enum: Object.values(Position),
          },
          {
            name: 'instruction',
            type: 'enum',
            enum: Object.values(PlayerInstruction),
          },
          { name: 'proficiency', type: 'tinyint', unsigned: true },
        ],
        indices: [
          {
            name: 'IDX_role_proficiencies_career_player_id',
            columnNames: ['careerPlayerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_role_proficiencies_player_position_instruction',
            columnNames: ['careerPlayerId', 'position', 'instruction'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_role_proficiencies_career_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    for (const entry of INSTRUCTIONS_BY_POSITION) {
      for (const instruction of entry.instructions) {
        await queryRunner.query(
          `INSERT INTO career_player_role_proficiencies
            (careerPlayerId, position, instruction, proficiency)
           SELECT careerPlayerId, ?, ?, ?
           FROM rosters
           WHERE role = ? AND starterPosition = ?`,
          [
            entry.position,
            instruction,
            INITIAL_ROLE_PROFICIENCY,
            'STARTER',
            entry.position,
          ],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('career_player_role_proficiencies');
    await queryRunner.dropColumn('match_player_stats', 'roleProficiency');
    await queryRunner.dropColumn('match_player_stats', 'playerInstruction');
    await queryRunner.dropColumn('rosters', 'playerInstruction');
  }
}
