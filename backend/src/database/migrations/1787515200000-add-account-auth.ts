import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

const LEGACY_ACCOUNT_EMAIL = 'legacy-save@local.invalid';

export class AddAccountAuth1787515200000 implements MigrationInterface {
  name = 'AddAccountAuth1787515200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'accounts',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'email', type: 'varchar', length: '191' },
          { name: 'passwordHash', type: 'varchar', length: '255' },
          { name: 'displayName', type: 'varchar', length: '50' },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'UQ_accounts_email',
            columnNames: ['email'],
            isUnique: true,
          },
        ],
      }),
    );

    await queryRunner.addColumn(
      'careers',
      new TableColumn({
        name: 'accountId',
        type: 'int',
        unsigned: true,
        isNullable: true,
      }),
    );
    await queryRunner.query(
      `INSERT INTO accounts (email, passwordHash, displayName)
       VALUES (?, ?, ?)`,
      [LEGACY_ACCOUNT_EMAIL, 'disabled', 'Legacy Save'],
    );
    await queryRunner.query(
      `UPDATE careers
       SET accountId = (
         SELECT id FROM accounts WHERE email = ? LIMIT 1
       )
       WHERE accountId IS NULL`,
      [LEGACY_ACCOUNT_EMAIL],
    );
    await queryRunner.changeColumn(
      'careers',
      'accountId',
      new TableColumn({
        name: 'accountId',
        type: 'int',
        unsigned: true,
        isNullable: false,
      }),
    );
    await queryRunner.createIndex(
      'careers',
      new TableIndex({
        name: 'IDX_careers_account_id',
        columnNames: ['accountId'],
      }),
    );
    await queryRunner.createForeignKey(
      'careers',
      new TableForeignKey({
        name: 'FK_careers_account',
        columnNames: ['accountId'],
        referencedTableName: 'accounts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('careers', 'FK_careers_account');
    await queryRunner.dropIndex('careers', 'IDX_careers_account_id');
    await queryRunner.dropColumn('careers', 'accountId');
    await queryRunner.dropTable('accounts');
  }
}
