import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeriesDrafts1789596000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE match_series ADD drafts json NULL');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE match_series DROP COLUMN drafts');
  }
}
