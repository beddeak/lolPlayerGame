import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CareersModule } from './careers/careers.module';
import { validateEnvironment } from './config/environment.validation';
import { MatchesModule } from './matches/matches.module';
import { MatchSeriesModule } from './match-series/match-series.module';
import { PlayersModule } from './players/players.module';
import { SetBonusesModule } from './set-bonuses/set-bonuses.module';
import { LeaguesModule } from './leagues/leagues.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const useSsl = configService.getOrThrow<string>('DB_SSL') === 'true';

        return {
          type: 'mysql',
          host: configService.getOrThrow<string>('DB_HOST'),
          port: configService.getOrThrow<number>('DB_PORT'),
          username: configService.getOrThrow<string>('DB_USERNAME'),
          password: configService.getOrThrow<string>('DB_PASSWORD'),
          database: configService.getOrThrow<string>('DB_DATABASE'),
          autoLoadEntities: true,
          migrationsRun: false,
          ssl: useSsl ? { rejectUnauthorized: true } : undefined,
          synchronize: false,
        };
      },
    }),

    AuthModule,
    PlayersModule,
    SetBonusesModule,
    CareersModule,
    MatchesModule,
    MatchSeriesModule,
    LeaguesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
