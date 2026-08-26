import { MigrationInterface, QueryRunner } from 'typeorm';

const TYPEORM_RELATION_INDEX = 'REL_a03c6e6feb2cee868b9beeff2e';
const DOMAIN_INDEX = 'UQ_rosters_career_player';

export class FixRosterOneToOneIndex1787601600000 implements MigrationInterface {
  name = 'FixRosterOneToOneIndex1787601600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`rosters\` RENAME INDEX \`${DOMAIN_INDEX}\` TO \`${TYPEORM_RELATION_INDEX}\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`rosters\` RENAME INDEX \`${TYPEORM_RELATION_INDEX}\` TO \`${DOMAIN_INDEX}\``,
    );
  }
}
