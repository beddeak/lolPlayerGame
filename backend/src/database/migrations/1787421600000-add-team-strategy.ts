import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';

export class AddTeamStrategy1787421600000 implements MigrationInterface {
  name = 'AddTeamStrategy1787421600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'career_teams',
      new TableColumn({
        name: 'teamStrategy',
        type: 'enum',
        enum: Object.values(TeamStrategy),
        default: `'${TeamStrategy.BALANCED}'`,
      }),
    );
    await queryRunner.addColumn(
      'matches',
      new TableColumn({
        name: 'teamAStrategy',
        type: 'enum',
        enum: Object.values(TeamStrategy),
        default: `'${TeamStrategy.BALANCED}'`,
      }),
    );
    await queryRunner.addColumn(
      'matches',
      new TableColumn({
        name: 'teamBStrategy',
        type: 'enum',
        enum: Object.values(TeamStrategy),
        default: `'${TeamStrategy.BALANCED}'`,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('matches', 'teamBStrategy');
    await queryRunner.dropColumn('matches', 'teamAStrategy');
    await queryRunner.dropColumn('career_teams', 'teamStrategy');
  }
}
