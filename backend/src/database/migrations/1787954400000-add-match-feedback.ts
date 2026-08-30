import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';
import { CAREER_PLAYER_STATE_CONFIG } from '../../careers/config/player-state.config';
import { FeedbackOption } from '../../match-series/enums/feedback-option.enum';
import { FeedbackType } from '../../match-series/enums/feedback-type.enum';
import { PlayerPersonality } from '../../players/enums/player-personality.enum';

export class AddMatchFeedback1787954400000 implements MigrationInterface {
  name = 'AddMatchFeedback1787954400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'player_cards',
      new TableColumn({
        name: 'personality',
        type: 'enum',
        enum: Object.values(PlayerPersonality),
        default: `'${PlayerPersonality.PROFESSIONAL}'`,
      }),
    );
    await queryRunner.addColumns('career_players', [
      new TableColumn({
        name: 'personality',
        type: 'enum',
        enum: Object.values(PlayerPersonality),
        default: `'${PlayerPersonality.PROFESSIONAL}'`,
      }),
      new TableColumn({
        name: 'coachTrust',
        type: 'tinyint',
        unsigned: true,
        default: CAREER_PLAYER_STATE_CONFIG.initial.coachTrust,
      }),
    ]);

    await queryRunner.query(`
      UPDATE career_players careerPlayer
      INNER JOIN player_cards playerCard
        ON playerCard.id = careerPlayer.playerCardId
      SET careerPlayer.personality = playerCard.personality
    `);

    await queryRunner.createTable(
      new Table({
        name: 'match_feedbacks',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'seriesId', type: 'int', unsigned: true },
          { name: 'afterGameId', type: 'int', unsigned: true },
          { name: 'afterGameNumber', type: 'tinyint', unsigned: true },
          {
            name: 'type',
            type: 'enum',
            enum: Object.values(FeedbackType),
          },
          {
            name: 'option',
            type: 'enum',
            enum: Object.values(FeedbackOption),
          },
          { name: 'targetTeamId', type: 'int', unsigned: true },
          {
            name: 'targetCareerPlayerId',
            type: 'int',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 0,
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          { name: 'IDX_match_feedbacks_series_id', columnNames: ['seriesId'] },
          {
            name: 'IDX_match_feedbacks_after_game_id',
            columnNames: ['afterGameId'],
          },
          {
            name: 'IDX_match_feedbacks_target_team_id',
            columnNames: ['targetTeamId'],
          },
          {
            name: 'IDX_match_feedbacks_target_player_id',
            columnNames: ['targetCareerPlayerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_match_feedbacks_series_game',
            columnNames: ['seriesId', 'afterGameNumber'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_match_feedbacks_series',
            columnNames: ['seriesId'],
            referencedTableName: 'match_series',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_match_feedbacks_after_game',
            columnNames: ['afterGameId'],
            referencedTableName: 'matches',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_match_feedbacks_target_team',
            columnNames: ['targetTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_match_feedbacks_target_player',
            columnNames: ['targetCareerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'match_feedback_player_effects',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'feedbackId', type: 'int', unsigned: true },
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          {
            name: 'personality',
            type: 'enum',
            enum: Object.values(PlayerPersonality),
          },
          { name: 'mentalBefore', type: 'tinyint', unsigned: true },
          { name: 'mentalDelta', type: 'tinyint' },
          { name: 'mentalAfter', type: 'tinyint', unsigned: true },
          { name: 'formBefore', type: 'tinyint', unsigned: true },
          { name: 'formDelta', type: 'tinyint' },
          { name: 'formAfter', type: 'tinyint', unsigned: true },
          { name: 'coachTrustBefore', type: 'tinyint', unsigned: true },
          { name: 'coachTrustDelta', type: 'tinyint' },
          { name: 'coachTrustAfter', type: 'tinyint', unsigned: true },
        ],
        indices: [
          {
            name: 'IDX_feedback_player_effects_feedback_id',
            columnNames: ['feedbackId'],
          },
          {
            name: 'IDX_feedback_player_effects_career_player_id',
            columnNames: ['careerPlayerId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_feedback_player_effects_feedback_player',
            columnNames: ['feedbackId', 'careerPlayerId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_feedback_player_effects_feedback',
            columnNames: ['feedbackId'],
            referencedTableName: 'match_feedbacks',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_feedback_player_effects_career_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('match_feedback_player_effects');
    await queryRunner.dropTable('match_feedbacks');
    await queryRunner.dropColumns('career_players', [
      'coachTrust',
      'personality',
    ]);
    await queryRunner.dropColumn('player_cards', 'personality');
  }
}
