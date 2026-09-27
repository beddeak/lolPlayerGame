import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Connection-owned lock serializes normal season skip and temporary admin automation. */
export async function withCareerAutomationLock<T>(
  db: DataSource,
  careerId: number,
  work: () => Promise<T>,
): Promise<T> {
  const runner = db.createQueryRunner();
  await runner.connect();
  const name = `test-admin:${careerId}`;
  let acquired = false;
  try {
    const rows = (await runner.query('SELECT GET_LOCK(?, 0) AS acquired', [
      name,
    ])) as Array<{ acquired: number }>;
    acquired = Number(rows[0]?.acquired) === 1;
    if (!acquired)
      throw new ConflictException('다른 자동 진행 작업이 진행 중입니다.');
    return await work();
  } finally {
    try {
      if (acquired) await runner.query('SELECT RELEASE_LOCK(?)', [name]);
    } finally {
      await runner.release();
    }
  }
}
