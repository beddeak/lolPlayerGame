import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const INITIAL_CHAMPION_ARCHETYPES = [
  'LANE_BULLY',
  'HYPER_CARRY',
  'WEAKSIDE_SAFE',
  'GRAB',
  'UTILITY',
  'TANK_ENGAGE',
] as const;

const EXTENDED_CHAMPION_ARCHETYPES = [
  'TOP_TANK',
  'TOP_AD_BRUISER',
  'TOP_AP_BRUISER',
  'TOP_SIDE_LANE',
  'TOP_VALUE',
  'JUNGLE_ENGAGE',
  'JUNGLE_SCALING',
  'JUNGLE_EARLY_SNOWBALL',
  'MID_ASSASSIN',
  'MID_STANDING_MAGE',
  'MID_TANK',
  'MID_AP_BRUISER',
  'MID_AD_BRUISER',
  'MID_VALUE',
  ...INITIAL_CHAMPION_ARCHETYPES,
] as const;

export class ExpandChampionArchetypes1787695200000 implements MigrationInterface {
  name = 'ExpandChampionArchetypes1787695200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.changeArchetypeColumn(
      queryRunner,
      'rosters',
      EXTENDED_CHAMPION_ARCHETYPES,
    );
    await this.changeArchetypeColumn(
      queryRunner,
      'match_player_stats',
      EXTENDED_CHAMPION_ARCHETYPES,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const initialValues = INITIAL_CHAMPION_ARCHETYPES.map(
      (value) => `'${value}'`,
    ).join(', ');

    await queryRunner.query(
      `UPDATE \`rosters\` SET \`championArchetype\` = NULL WHERE \`championArchetype\` NOT IN (${initialValues})`,
    );
    await queryRunner.query(
      `UPDATE \`match_player_stats\` SET \`championArchetype\` = NULL WHERE \`championArchetype\` NOT IN (${initialValues})`,
    );
    await this.changeArchetypeColumn(
      queryRunner,
      'match_player_stats',
      INITIAL_CHAMPION_ARCHETYPES,
    );
    await this.changeArchetypeColumn(
      queryRunner,
      'rosters',
      INITIAL_CHAMPION_ARCHETYPES,
    );
  }

  private async changeArchetypeColumn(
    queryRunner: QueryRunner,
    tableName: string,
    values: readonly string[],
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);

    if (!table) {
      throw new Error(`${tableName} was not found`);
    }

    const currentColumn = table.findColumnByName('championArchetype');

    if (!currentColumn) {
      throw new Error(`${tableName}.championArchetype was not found`);
    }

    await queryRunner.changeColumn(
      table,
      currentColumn,
      new TableColumn({
        name: 'championArchetype',
        type: 'enum',
        enum: [...values],
        isNullable: true,
      }),
    );
  }
}
