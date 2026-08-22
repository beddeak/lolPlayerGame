import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { DataSource } from 'typeorm';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerPlayerRoleProficiency } from '../careers/entities/career-player-role-proficiency.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Career } from '../careers/entities/career.entity';
import { Roster } from '../careers/entities/roster.entity';
import { validateEnvironment } from '../config/environment.validation';
import { MatchPlayerStat } from '../matches/entities/match-player-stat.entity';
import { Match } from '../matches/entities/match.entity';
import { PlayerCard } from '../players/entities/player-card.entity';
import { Player } from '../players/entities/player.entity';
import { Theme } from '../players/entities/theme.entity';
import { CreateCareerDomain1787410800000 } from './migrations/1787410800000-create-career-domain';
import { AddPlayerCardImageUrl1787414400000 } from './migrations/1787414400000-add-player-card-image-url';
import { CreateMatchStats1787418000000 } from './migrations/1787418000000-create-match-stats';
import { AddTeamStrategy1787421600000 } from './migrations/1787421600000-add-team-strategy';
import { AddPlayerInstructionRoleProficiency1787425200000 } from './migrations/1787425200000-add-player-instruction-role-proficiency';
import { CreatePlayerCatalog1787237754573 } from './migrations/1787237754573-create-player-catalog';

if (existsSync('.env')) {
  loadEnvFile('.env');
}

const environment = validateEnvironment(process.env);
const useSsl = environment.DB_SSL === 'true';

const dataSource = new DataSource({
  type: 'mysql',
  host: environment.DB_HOST,
  port: environment.DB_PORT,
  username: environment.DB_USERNAME,
  password: environment.DB_PASSWORD,
  database: environment.DB_DATABASE,
  entities: [
    Player,
    Theme,
    PlayerCard,
    Career,
    CareerTeam,
    CareerPlayer,
    CareerPlayerRoleProficiency,
    Roster,
    Match,
    MatchPlayerStat,
  ],
  migrations: [
    CreatePlayerCatalog1787237754573,
    CreateCareerDomain1787410800000,
    AddPlayerCardImageUrl1787414400000,
    CreateMatchStats1787418000000,
    AddTeamStrategy1787421600000,
    AddPlayerInstructionRoleProficiency1787425200000,
  ],
  migrationsTableName: 'migrations',
  ssl: useSsl ? { rejectUnauthorized: true } : undefined,
  synchronize: false,
});

export default dataSource;
