import { join } from 'node:path';
import { DataSource, QueryRunner, Table } from 'typeorm';
import { MatchTacticalRun } from '../../matches/entities/match-tactical-run.entity';
import { MatchTacticalChunk } from '../../matches/entities/match-tactical-chunk.entity';
import { TacticalReplays1789768800000 } from './1789768800000-tactical-replays';

describe('tactical replay migration schema contract', () => {
  it('matches entity keys and fields without synchronizing or connecting to a database', async () => {
    const source = new DataSource({
      type: 'mysql',
      database: 'schema_contract_only',
      entities: [join(__dirname, '..', '..', '**', 'entities', '*.entity.ts')],
    });
    await (
      source as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const tables: Table[] = [];
    const runner = {
      changeColumn: jest.fn().mockResolvedValue(undefined),
      createTable: jest.fn(async (table: Table) => {
        tables.push(table);
      }),
    };
    await new TacticalReplays1789768800000().up(
      runner as unknown as QueryRunner,
    );
    for (const entity of [MatchTacticalRun, MatchTacticalChunk]) {
      const metadata = source.getMetadata(entity);
      const table = tables.find((entry) => entry.name === metadata.tableName)!;
      expect(table.columns.map((column) => column.name).sort()).toEqual(
        metadata.columns.map((column) => column.databaseName).sort(),
      );
      expect(
        table.columns
          .filter((column) => column.isPrimary)
          .map((column) => column.name)
          .sort(),
      ).toEqual(
        metadata.primaryColumns.map((column) => column.databaseName).sort(),
      );
      expect(
        table.indices
          .filter((index) => index.isUnique)
          .map((index) => index.name)
          .sort(),
      ).toEqual(
        metadata.indices
          .filter((index) => index.isUnique)
          .map((index) => index.name)
          .sort(),
      );
      // A generated OneToOne REL unique would otherwise silently drift from the migration.
      expect(metadata.uniques).toHaveLength(0);
      expect(table.foreignKeys.map((key) => key.name).sort()).toEqual(
        metadata.foreignKeys.map((key) => key.name).sort(),
      );
    }
    expect(runner.changeColumn).toHaveBeenCalledTimes(3);
  });

  it('refuses rollback that would silently lose unavailable or fractional historical metrics', async () => {
    const runner = {
      query: jest.fn().mockResolvedValue([{ id: 1 }]),
      dropTable: jest.fn(),
      changeColumn: jest.fn(),
    };
    await expect(
      new TacticalReplays1789768800000().down(runner as unknown as QueryRunner),
    ).rejects.toThrow('without losing');
    expect(runner.dropTable).not.toHaveBeenCalled();
  });
});
