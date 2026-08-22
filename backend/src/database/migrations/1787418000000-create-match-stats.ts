import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Position } from '../../players/enums/position.enum';

export class CreateMatchStats1787418000000 implements MigrationInterface {
  name = 'CreateMatchStats1787418000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'matches',
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
          { name: 'teamAId', type: 'int', unsigned: true },
          { name: 'teamBId', type: 'int', unsigned: true },
          { name: 'winnerTeamId', type: 'int', unsigned: true },
          { name: 'seed', type: 'int', unsigned: true },
          { name: 'durationMinutes', type: 'double' },
          { name: 'teamABaseAbility', type: 'double' },
          { name: 'teamARngModifier', type: 'double' },
          { name: 'teamAPerformance', type: 'double' },
          { name: 'teamBBaseAbility', type: 'double' },
          { name: 'teamBRngModifier', type: 'double' },
          { name: 'teamBPerformance', type: 'double' },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          { name: 'IDX_matches_career_id', columnNames: ['careerId'] },
          { name: 'IDX_matches_team_a_id', columnNames: ['teamAId'] },
          { name: 'IDX_matches_team_b_id', columnNames: ['teamBId'] },
          {
            name: 'IDX_matches_winner_team_id',
            columnNames: ['winnerTeamId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_matches_career',
            columnNames: ['careerId'],
            referencedTableName: 'careers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_matches_team_a',
            columnNames: ['teamAId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_matches_team_b',
            columnNames: ['teamBId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_matches_winner_team',
            columnNames: ['winnerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'match_player_stats',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'matchId', type: 'int', unsigned: true },
          { name: 'careerPlayerId', type: 'int', unsigned: true },
          { name: 'careerTeamId', type: 'int', unsigned: true },
          {
            name: 'position',
            type: 'enum',
            enum: Object.values(Position),
          },
          { name: 'kills', type: 'tinyint', unsigned: true },
          { name: 'deaths', type: 'tinyint', unsigned: true },
          { name: 'assists', type: 'tinyint', unsigned: true },
          { name: 'kda', type: 'double' },
          { name: 'dpm', type: 'double' },
          { name: 'damageShare', type: 'double' },
          { name: 'gold', type: 'int', unsigned: true },
          { name: 'goldShare', type: 'double' },
          { name: 'gdAt15', type: 'smallint' },
          { name: 'csdAt15', type: 'smallint' },
          { name: 'kp', type: 'double' },
          { name: 'rating', type: 'double' },
        ],
        indices: [
          {
            name: 'IDX_match_player_stats_match_id',
            columnNames: ['matchId'],
          },
          {
            name: 'IDX_match_player_stats_career_player_id',
            columnNames: ['careerPlayerId'],
          },
          {
            name: 'IDX_match_player_stats_career_team_id',
            columnNames: ['careerTeamId'],
          },
        ],
        uniques: [
          {
            name: 'UQ_match_player_stats_match_player',
            columnNames: ['matchId', 'careerPlayerId'],
          },
        ],
        foreignKeys: [
          {
            name: 'FK_match_player_stats_match',
            columnNames: ['matchId'],
            referencedTableName: 'matches',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_match_player_stats_career_player',
            columnNames: ['careerPlayerId'],
            referencedTableName: 'career_players',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_match_player_stats_career_team',
            columnNames: ['careerTeamId'],
            referencedTableName: 'career_teams',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('match_player_stats');
    await queryRunner.dropTable('matches');
  }
}
