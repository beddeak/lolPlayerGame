import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

const PREVIOUS_EVENT_TYPES = [
  'SCHEDULED_GAME',
  'CONTRACT_RESPONSE',
  'LEGEND_REVEAL',
  'PLAYER_MEETING',
  'INTERNATIONAL_ROSTER_REGISTRATION',
  'SEASON_REVIEW',
  'TRANSFER_WINDOW_OPEN',
] as const;

const EVENT_TYPES = [...PREVIOUS_EVENT_TYPES, 'CONTRACT_EXPIRATION'] as const;

export class CreateTransfers1788559200000 implements MigrationInterface {
  name = 'CreateTransfers1788559200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.changeCalendarEventType(queryRunner, EVENT_TYPES);
    await queryRunner.addColumns('player_contracts', [
      new TableColumn({
        name: 'status',
        type: 'enum',
        enum: ['ACTIVE', 'EXPIRED', 'TERMINATED'],
        default: "'ACTIVE'",
      }),
      new TableColumn({ name: 'endedDate', type: 'date', isNullable: true }),
      new TableColumn({
        name: 'endReason',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    ]);

    await queryRunner.createTable(
      new Table({
        name: 'transfer_agreements',
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
          { name: 'buyerCareerTeamId', type: 'int', unsigned: true },
          { name: 'sellerCareerTeamId', type: 'int', unsigned: true },
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          { name: 'offeredFee', type: 'int', unsigned: true },
          { name: 'requiredFee', type: 'int', unsigned: true },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED'],
          },
          { name: 'offeredDate', type: 'date' },
          { name: 'resolvedDate', type: 'date' },
          { name: 'reason', type: 'varchar', length: '255' },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_transfer_agreements_career_id',
            columnNames: ['careerId'],
          },
          {
            name: 'IDX_transfer_agreements_buyer_status',
            columnNames: ['buyerCareerTeamId', 'status'],
          },
          {
            name: 'IDX_transfer_agreements_seller_team_id',
            columnNames: ['sellerCareerTeamId'],
          },
          {
            name: 'IDX_transfer_agreements_player_id',
            columnNames: ['careerPlayerId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_transfer_agreements_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_transfer_agreements_buyer_team',
            columnNames: ['buyerCareerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_transfer_agreements_seller_team',
            columnNames: ['sellerCareerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_transfer_agreements_player',
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
        name: 'transfer_records',
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
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          {
            name: 'sourceCareerTeamId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'destinationCareerTeamId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'transferAgreementId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'contractOfferId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'type',
            type: 'enum',
            enum: [
              'TRANSFER',
              'FREE_AGENT_SIGNING',
              'RELEASE',
              'CONTRACT_EXPIRATION',
            ],
          },
          { name: 'transferFee', type: 'int', unsigned: true, default: 0 },
          { name: 'completedDate', type: 'date' },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_transfer_records_career_date',
            columnNames: ['careerId', 'completedDate'],
          },
          {
            name: 'IDX_transfer_records_player_id',
            columnNames: ['careerPlayerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_transfer_records_contract_offer',
            columnNames: ['contractOfferId'],
          },
          {
            name: 'UQ_transfer_records_agreement',
            columnNames: ['transferAgreementId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_transfer_records_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_transfer_records_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_transfer_records_source_team',
            columnNames: ['sourceCareerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            name: 'FK_transfer_records_destination_team',
            columnNames: ['destinationCareerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            name: 'FK_transfer_records_agreement',
            columnNames: ['transferAgreementId'],
            referencedTableName: 'transfer_agreements',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            name: 'FK_transfer_records_contract_offer',
            columnNames: ['contractOfferId'],
            referencedTableName: 'contract_offers',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    await queryRunner.addColumns('contract_offers', [
      new TableColumn({
        name: 'offerType',
        type: 'enum',
        enum: ['RENEWAL', 'FREE_AGENT', 'TRANSFER'],
        default: "'RENEWAL'",
      }),
      new TableColumn({
        name: 'sourceCareerTeamId',
        type: 'int',
        unsigned: true,
        isNullable: true,
      }),
      new TableColumn({
        name: 'transferAgreementId',
        type: 'int',
        unsigned: true,
        isNullable: true,
      }),
    ]);
    await queryRunner.query(
      "UPDATE `contract_offers` SET `sourceCareerTeamId` = `careerTeamId` WHERE `offerType` = 'RENEWAL'",
    );
    await queryRunner.createIndices('contract_offers', [
      new TableIndex({
        name: 'IDX_contract_offers_source_team_id',
        columnNames: ['sourceCareerTeamId'],
      }),
      new TableIndex({
        name: 'IDX_contract_offers_transfer_agreement_id',
        columnNames: ['transferAgreementId'],
      }),
    ]);
    await queryRunner.createForeignKeys('contract_offers', [
      new TableForeignKey({
        name: 'FK_contract_offers_source_team',
        columnNames: ['sourceCareerTeamId'],
        referencedTableName: 'career_teams',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
      new TableForeignKey({
        name: 'FK_contract_offers_transfer_agreement',
        columnNames: ['transferAgreementId'],
        referencedTableName: 'transfer_agreements',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    ]);

    await queryRunner.query(`
      INSERT INTO calendar_events
        (careerId, scheduledDate, type, status, requiresUserAction, payload, createdAt, completedAt)
      SELECT
        careerId,
        DATE_ADD(endDate, INTERVAL 1 DAY),
        'CONTRACT_EXPIRATION',
        'SCHEDULED',
        0,
        JSON_OBJECT(
          'playerContractId', id,
          'careerPlayerId', careerPlayerId,
          'sourceOfferId', sourceOfferId
        ),
        CURRENT_TIMESTAMP,
        NULL
      FROM player_contracts
      WHERE status = 'ACTIVE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `calendar_events` WHERE `type` = 'CONTRACT_EXPIRATION'",
    );
    const offers = await queryRunner.getTable('contract_offers');
    if (!offers) throw new Error('contract_offers was not found');
    for (const foreignKeyName of [
      'FK_contract_offers_transfer_agreement',
      'FK_contract_offers_source_team',
    ]) {
      const foreignKey = offers.foreignKeys.find(
        (value) => value.name === foreignKeyName,
      );
      if (foreignKey) await queryRunner.dropForeignKey(offers, foreignKey);
    }
    for (const indexName of [
      'IDX_contract_offers_transfer_agreement_id',
      'IDX_contract_offers_source_team_id',
    ]) {
      const index = offers.indices.find((value) => value.name === indexName);
      if (index) await queryRunner.dropIndex(offers, index);
    }
    await queryRunner.dropColumns('contract_offers', [
      'transferAgreementId',
      'sourceCareerTeamId',
      'offerType',
    ]);
    await queryRunner.dropTable('transfer_records');
    await queryRunner.dropTable('transfer_agreements');
    await queryRunner.dropColumns('player_contracts', [
      'endReason',
      'endedDate',
      'status',
    ]);
    await this.changeCalendarEventType(queryRunner, PREVIOUS_EVENT_TYPES);
  }

  private async changeCalendarEventType(
    queryRunner: QueryRunner,
    values: readonly string[],
  ): Promise<void> {
    const table = await queryRunner.getTable('calendar_events');
    if (!table) throw new Error('calendar_events was not found');
    const current = table.findColumnByName('type');
    if (!current) throw new Error('calendar_events.type was not found');
    await queryRunner.changeColumn(
      table,
      current,
      new TableColumn({ name: 'type', type: 'enum', enum: [...values] }),
    );
  }
}
