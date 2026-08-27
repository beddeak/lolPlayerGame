import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { CAREER_PLAYER_STATE_CONFIG } from '../../careers/config/player-state.config';

export class AddPlayerMatchState1787868000000 implements MigrationInterface {
  name = 'AddPlayerMatchState1787868000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('career_players', [
      new TableColumn({
        name: 'form',
        type: 'tinyint',
        unsigned: true,
        default: CAREER_PLAYER_STATE_CONFIG.initial.form,
      }),
      new TableColumn({
        name: 'condition',
        type: 'tinyint',
        unsigned: true,
        default: CAREER_PLAYER_STATE_CONFIG.initial.condition,
      }),
    ]);

    await queryRunner.addColumns('matches', [
      new TableColumn({
        name: 'teamAStateModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({
        name: 'teamBStateModifier',
        type: 'double',
        default: 0,
      }),
    ]);

    await queryRunner.addColumns('match_player_stats', [
      new TableColumn({
        name: 'form',
        type: 'tinyint',
        unsigned: true,
        default: CAREER_PLAYER_STATE_CONFIG.initial.form,
      }),
      new TableColumn({
        name: 'condition',
        type: 'tinyint',
        unsigned: true,
        default: CAREER_PLAYER_STATE_CONFIG.initial.condition,
      }),
      new TableColumn({
        name: 'mental',
        type: 'tinyint',
        unsigned: true,
        default: 50,
      }),
      new TableColumn({ name: 'formModifier', type: 'double', default: 0 }),
      new TableColumn({
        name: 'conditionModifier',
        type: 'double',
        default: 0,
      }),
      new TableColumn({ name: 'mentalModifier', type: 'double', default: 0 }),
      new TableColumn({ name: 'stateModifier', type: 'double', default: 0 }),
      new TableColumn({
        name: 'formAfter',
        type: 'tinyint',
        unsigned: true,
        default: CAREER_PLAYER_STATE_CONFIG.initial.form,
      }),
      new TableColumn({
        name: 'conditionAfter',
        type: 'tinyint',
        unsigned: true,
        default: CAREER_PLAYER_STATE_CONFIG.initial.condition,
      }),
      new TableColumn({
        name: 'mentalAfter',
        type: 'tinyint',
        unsigned: true,
        default: 50,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('match_player_stats', [
      'mentalAfter',
      'conditionAfter',
      'formAfter',
      'stateModifier',
      'mentalModifier',
      'conditionModifier',
      'formModifier',
      'mental',
      'condition',
      'form',
    ]);
    await queryRunner.dropColumns('matches', [
      'teamBStateModifier',
      'teamAStateModifier',
    ]);
    await queryRunner.dropColumns('career_players', ['condition', 'form']);
  }
}
