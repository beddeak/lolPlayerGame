import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLcpCblol1789336800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['club_catalog', 'career_teams', 'league_splits'])
      await queryRunner.query(
        `ALTER TABLE ${table} MODIFY region enum('LCK','LPL','LEC','LCS','LCP','CBLOL') NOT NULL`,
      );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['club_catalog', 'career_teams', 'league_splits']) {
      const rows = (await queryRunner.query(
        `SELECT COUNT(*) AS count FROM ${table} WHERE region IN ('LCP','CBLOL')`,
      )) as { count: string }[];
      if (Number(rows[0].count))
        throw new Error('Cannot remove regions containing user data');
    }
    for (const table of ['club_catalog', 'career_teams', 'league_splits'])
      await queryRunner.query(
        `ALTER TABLE ${table} MODIFY region enum('LCK','LPL','LEC','LCS') NOT NULL`,
      );
  }
}
