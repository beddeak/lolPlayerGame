import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class IntermissionFeedback1789682400000 implements MigrationInterface {
  name = 'IntermissionFeedback1789682400000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.createIndex(
      'match_feedbacks',
      new TableIndex({
        name: 'UQ_match_feedbacks_series_game_type',
        columnNames: ['seriesId', 'afterGameNumber', 'type'],
        isUnique: true,
      }),
    );
    await runner.dropIndex('match_feedbacks', 'UQ_match_feedbacks_series_game');
    await runner.addColumn(
      'match_feedback_player_effects',
      new TableColumn({ name: 'reaction', type: 'json', isNullable: true }),
    );
    await runner.addColumn(
      'match_player_stats',
      new TableColumn({ name: 'feedback', type: 'json', isNullable: true }),
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    // Do not silently delete either talk to restore the old one-talk constraint.
    const duplicates: unknown = await runner.query(
      'SELECT seriesId FROM match_feedbacks GROUP BY seriesId, afterGameNumber HAVING COUNT(*) > 1 LIMIT 1',
    );
    if (!Array.isArray(duplicates) || duplicates.length)
      throw new Error(
        'Cannot revert while two feedback types exist for one break; preserve/export the feedback history first.',
      );
    await runner.createIndex(
      'match_feedbacks',
      new TableIndex({
        name: 'UQ_match_feedbacks_series_game',
        columnNames: ['seriesId', 'afterGameNumber'],
        isUnique: true,
      }),
    );
    await runner.dropIndex(
      'match_feedbacks',
      'UQ_match_feedbacks_series_game_type',
    );
    await runner.dropColumn('match_feedback_player_effects', 'reaction');
    await runner.dropColumn('match_player_stats', 'feedback');
  }
}
