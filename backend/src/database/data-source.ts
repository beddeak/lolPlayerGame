import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/environment.validation';
import { PlayerCard } from '../players/entities/player-card.entity';
import { Player } from '../players/entities/player.entity';
import { Theme } from '../players/entities/theme.entity';
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
  entities: [Player, Theme, PlayerCard],
  migrations: [CreatePlayerCatalog1787237754573],
  migrationsTableName: 'migrations',
  ssl: useSsl ? { rejectUnauthorized: true } : undefined,
  synchronize: false,
});

export default dataSource;
