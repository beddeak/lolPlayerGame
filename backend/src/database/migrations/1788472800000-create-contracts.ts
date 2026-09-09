import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateContracts1788472800000 implements MigrationInterface {
  name = 'CreateContracts1788472800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'contract_offers',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'careerId', type: 'int', unsigned: true },
          { name: 'careerTeamId', type: 'int', unsigned: true },
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          {
            name: 'status',
            type: 'enum',
            enum: [
              'WAITING_PLAYER_RESPONSE',
              'PLAYER_ACCEPTED',
              'COUNTER_OFFERED',
              'REJECTED',
              'WITHDRAWN',
              'SIGNED',
            ],
            default: "'WAITING_PLAYER_RESPONSE'",
          },
          { name: 'revision', type: 'int', unsigned: true, default: 1 },
          { name: 'offeredDate', type: 'date' },
          { name: 'responseDate', type: 'date' },
          {
            name: 'responseEventId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          { name: 'terms', type: 'json' },
          { name: 'counterTerms', type: 'json', isNullable: true },
          { name: 'response', type: 'json', isNullable: true },
          {
            name: 'extensionsUsed',
            type: 'tinyint',
            unsigned: true,
            default: 0,
          },
          { name: 'history', type: 'json' },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          { name: 'IDX_contract_offers_career_id', columnNames: ['careerId'] },
          {
            name: 'IDX_contract_offers_team_id',
            columnNames: ['careerTeamId'],
          },
          {
            name: 'IDX_contract_offers_player_id',
            columnNames: ['careerPlayerId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_contract_offers_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_contract_offers_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_contract_offers_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'player_contracts',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'careerId', type: 'int', unsigned: true },
          { name: 'careerTeamId', type: 'int', unsigned: true },
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          { name: 'sourceOfferId', type: 'int', unsigned: true },
          { name: 'signedDate', type: 'date' },
          { name: 'startDate', type: 'date' },
          { name: 'endDate', type: 'date' },
          { name: 'terms', type: 'json' },
          { name: 'promises', type: 'json' },
        ],
        indices: [
          { name: 'IDX_player_contracts_career_id', columnNames: ['careerId'] },
          {
            name: 'IDX_player_contracts_team_id',
            columnNames: ['careerTeamId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_player_contracts_player',
            columnNames: ['careerPlayerId'],
          },
          {
            name: 'UQ_player_contracts_source_offer',
            columnNames: ['sourceOfferId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_player_contracts_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_player_contracts_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_player_contracts_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_player_contracts_source_offer',
            columnNames: ['sourceOfferId'],
            referencedTableName: 'contract_offers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('player_contracts');
    await queryRunner.dropTable('contract_offers');
  }
}
