import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const INITIAL_CHAMPION_ARCHETYPES = [
  'LANE_BULLY',
  'HYPER_CARRY',
  'WEAKSIDE_SAFE',
  'GRAB',
  'UTILITY',
  'TANK_ENGAGE',
] as const;

export class AddChampionArchetypes1787608800000 implements MigrationInterface {
  name = 'AddChampionArchetypes1787608800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const archetypeColumn = (name: string) =>
      new TableColumn({
        name,
        type: 'enum',
        enum: [...INITIAL_CHAMPION_ARCHETYPES],
        isNullable: true,
      });

    await queryRunner.addColumn(
      'rosters',
      archetypeColumn('championArchetype'),
    );
    await queryRunner.addColumn(
      'match_player_stats',
      archetypeColumn('championArchetype'),
    );
    await queryRunner.addColumns('matches', [
      new TableColumn({
        name: 'teamAArchetypeModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamBArchetypeModifier',
        type: 'double',
        default: 0,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('matches', [
      'teamBArchetypeModifier',
      'teamAArchetypeModifier',
    ]);
    await queryRunner.dropColumn('match_player_stats', 'championArchetype');
    await queryRunner.dropColumn('rosters', 'championArchetype');
  }
}
