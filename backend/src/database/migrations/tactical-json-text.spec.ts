import type { QueryRunner } from 'typeorm';
import { TacticalJsonText1789855200000 } from './1789855200000-tactical-json-text';

describe('lossless tactical envelope migration', () => {
  it('changes column formats in place without dropping data or rewriting hashes', async () => {
    const runner = { query: jest.fn().mockResolvedValue([]) };
    await new TacticalJsonText1789855200000().up(
      runner as unknown as QueryRunner,
    );
    expect(runner.query).toHaveBeenCalledTimes(2);
    for (const [sql] of runner.query.mock.calls as [string][]) {
      expect(sql).toContain('MODIFY COLUMN');
      expect(sql).toContain('longtext');
      expect(sql).not.toMatch(/DROP|DELETE|UPDATE/i);
    }
  });

  it('refuses a lossy rollback while any tactical run exists', async () => {
    const runner = { query: jest.fn().mockResolvedValue([{ id: 1 }]) };
    await expect(
      new TacticalJsonText1789855200000().down(
        runner as unknown as QueryRunner,
      ),
    ).rejects.toThrow('invalidate stored hashes');
    expect(runner.query).toHaveBeenCalledTimes(1);
  });

  it('allows rollback of empty tables', async () => {
    const runner = { query: jest.fn().mockResolvedValue([]) };
    await new TacticalJsonText1789855200000().down(
      runner as unknown as QueryRunner,
    );
    expect(runner.query).toHaveBeenCalledTimes(3);
  });
});
