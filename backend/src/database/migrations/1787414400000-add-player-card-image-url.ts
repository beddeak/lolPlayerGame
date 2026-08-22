import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPlayerCardImageUrl1787414400000 implements MigrationInterface {
  name = 'AddPlayerCardImageUrl1787414400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'player_cards',
      new TableColumn({
        name: 'imageUrl',
        type: 'varchar',
        length: '500',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('player_cards', 'imageUrl');
  }
}
