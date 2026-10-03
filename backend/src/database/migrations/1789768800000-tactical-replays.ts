import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class TacticalReplays1789768800000 implements MigrationInterface {
  name = 'TacticalReplays1789768800000';

  async up(runner: QueryRunner): Promise<void> {
    // MySQL QueryRunner.changeColumn drops/re-adds columns when their type
    // changes. MODIFY converts in place and preserves historical match values.
    await runner.query(
      'ALTER TABLE `match_player_stats` MODIFY COLUMN `gold` double NOT NULL, MODIFY COLUMN `gdAt15` double NULL, MODIFY COLUMN `csdAt15` smallint NULL',
    );
    await runner.createTable(
      new Table({
        name: 'match_tactical_runs',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'executionKey', type: 'varchar', length: '64' },
          { name: 'careerId', type: 'int', unsigned: true },
          { name: 'matchId', type: 'int', unsigned: true, isNullable: true },
          { name: 'status', type: 'varchar', length: '24' },
          { name: 'engineVersion', type: 'varchar', length: '80' },
          { name: 'inputHash', type: 'varchar', length: '64' },
          { name: 'input', type: 'json', isNullable: true },
          { name: 'draft', type: 'json' },
          { name: 'feedbackIds', type: 'json' },
          { name: 'currentMeta', type: 'varchar', length: '40' },
          { name: 'simTimeMs', type: 'int', unsigned: true, default: 0 },
          {
            name: 'leaseToken',
            type: 'varchar',
            length: '36',
            isNullable: true,
          },
          {
            name: 'leaseExpiresAt',
            type: 'datetime',
            precision: 3,
            isNullable: true,
          },
          { name: 'checkpoint', type: 'longblob', isNullable: true },
          { name: 'manifest', type: 'json', isNullable: true },
          { name: 'error', type: 'varchar', length: '1000', isNullable: true },
        ],
        indices: [
          {
            name: 'UQ_tactical_run_execution',
            columnNames: ['executionKey'],
            isUnique: true,
          },
          {
            name: 'UQ_tactical_run_match',
            columnNames: ['matchId'],
            isUnique: true,
          },
        ],
        foreignKeys: [
          {
            name: 'FK_tactical_run_match',
            columnNames: ['matchId'],
            referencedTableName: 'matches',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_tactical_run_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
    await runner.createTable(
      new Table({
        name: 'match_tactical_chunks',
        columns: [
          { name: 'runId', type: 'int', unsigned: true, isPrimary: true },
          { name: 'chunkIndex', type: 'int', unsigned: true, isPrimary: true },
          { name: 'payload', type: 'json' },
        ],
        foreignKeys: [
          {
            name: 'FK_tactical_chunk_run',
            columnNames: ['runId'],
            referencedTableName: 'match_tactical_runs',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const incompatible: unknown = await runner.query(
      'SELECT id FROM match_player_stats WHERE gold <> FLOOR(gold) OR gold < 0 OR gold > 4294967295 OR gdAt15 IS NULL OR csdAt15 IS NULL OR gdAt15 <> FLOOR(gdAt15) OR gdAt15 < -32768 OR gdAt15 > 32767 LIMIT 1',
    );
    if (!Array.isArray(incompatible) || incompatible.length)
      throw new Error(
        'Cannot revert tactical statistics without losing fractional or unavailable metrics. Preserve/export the results first.',
      );
    await runner.dropTable('match_tactical_chunks');
    await runner.dropTable('match_tactical_runs');
    await runner.query(
      'ALTER TABLE `match_player_stats` MODIFY COLUMN `gold` int UNSIGNED NOT NULL, MODIFY COLUMN `gdAt15` smallint NOT NULL, MODIFY COLUMN `csdAt15` smallint NOT NULL',
    );
  }
}
