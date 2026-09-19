import { MigrationInterface, QueryRunner } from 'typeorm';

export class InternationalTournaments1789250400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE international_tournaments (
      id int UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      careerId int UNSIGNED NOT NULL, year smallint UNSIGNED NOT NULL,
      kind enum('FIRST_STAND','MSI','WORLDS') NOT NULL,
      state json NOT NULL, registeredRosters json NOT NULL, rosterConfirmed tinyint NOT NULL DEFAULT 0,
      UNIQUE KEY UQ_international_career_year_kind (careerId, year, kind),
      INDEX IDX_international_career (careerId),
      CONSTRAINT FK_international_career FOREIGN KEY (careerId) REFERENCES careers(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await queryRunner.query(`CREATE TABLE international_fixtures (
      id int UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tournamentId int UNSIGNED NOT NULL, \`key\` varchar(40) NOT NULL,
      seriesId int UNSIGNED NULL, eventId int UNSIGNED NOT NULL,
      UNIQUE KEY UQ_international_fixture_key (tournamentId, \`key\`),
      UNIQUE KEY UQ_international_fixture_series (seriesId),
      INDEX IDX_international_fixture_tournament (tournamentId), INDEX IDX_international_fixture_event (eventId),
      CONSTRAINT FK_international_fixture_tournament FOREIGN KEY (tournamentId) REFERENCES international_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT FK_international_fixture_series FOREIGN KEY (seriesId) REFERENCES match_series(id) ON DELETE SET NULL,
      CONSTRAINT FK_international_fixture_event FOREIGN KEY (eventId) REFERENCES calendar_events(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      'SELECT COUNT(*) AS count FROM international_tournaments',
    )) as { count: string }[];
    if (Number(rows[0].count))
      throw new Error(
        'Cannot remove international tables containing saved tournaments',
      );
    await queryRunner.query('DROP TABLE international_fixtures');
    await queryRunner.query('DROP TABLE international_tournaments');
  }
}
