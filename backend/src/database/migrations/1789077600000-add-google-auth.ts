import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class AddGoogleAuth1789077600000 implements MigrationInterface {
  name = 'AddGoogleAuth1789077600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      'accounts',
      'passwordHash',
      new TableColumn({
        name: 'passwordHash',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'social_identities',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'provider', type: 'enum', enum: ['GOOGLE'] },
          {
            name: 'subject',
            type: 'varchar',
            length: '255',
            collation: 'utf8mb4_bin',
          },
          { name: 'accountId', type: 'int', unsigned: true },
          { name: 'email', type: 'varchar', length: '191' },
        ],
        uniques: [
          {
            name: 'UQ_social_identities_provider_subject',
            columnNames: ['provider', 'subject'],
          },
          {
            name: 'UQ_social_identities_account_provider',
            columnNames: ['accountId', 'provider'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_social_identities_account',
            columnNames: ['accountId'],
            referencedTableName: 'accounts',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'google_auth_challenges',
        columns: [
          {
            name: 'tokenHash',
            type: 'char',
            length: '64',
            collation: 'utf8mb4_bin',
            isPrimary: true,
          },
          {
            name: 'nonceHash',
            type: 'char',
            length: '64',
            collation: 'utf8mb4_bin',
          },
          { name: 'action', type: 'enum', enum: ['LOGIN', 'LINK'] },
          { name: 'accountId', type: 'int', unsigned: true, isNullable: true },
          { name: 'expiresAt', type: 'datetime', precision: 3 },
        ],
        indices: [
          {
            name: 'IDX_google_auth_challenges_account',
            columnNames: ['accountId'],
          },
          {
            name: 'IDX_google_auth_challenges_expires',
            columnNames: ['expiresAt'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_google_auth_challenges_account',
            columnNames: ['accountId'],
            referencedTableName: 'accounts',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const googleOnly = await queryRunner.manager
      .createQueryBuilder()
      .select('1')
      .from('accounts', 'account')
      .where('account.passwordHash IS NULL')
      .getRawOne<unknown>();
    if (googleOnly) {
      throw new Error(
        'Cannot revert Google auth while passwordless accounts exist. Preserve or migrate those accounts first.',
      );
    }
    await queryRunner.dropTable('google_auth_challenges');
    await queryRunner.dropTable('social_identities');
    await queryRunner.changeColumn(
      'accounts',
      'passwordHash',
      new TableColumn({
        name: 'passwordHash',
        type: 'varchar',
        length: '255',
        isNullable: false,
      }),
    );
  }
}
