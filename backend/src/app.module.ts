import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CareersModule } from './careers/careers.module';
import { ClubsModule } from './clubs/clubs.module';
import { validateEnvironment } from './config/environment.validation';
import { MatchesModule } from './matches/matches.module';
import { MatchSeriesModule } from './match-series/match-series.module';
import { PlayersModule } from './players/players.module';
import { SetBonusesModule } from './set-bonuses/set-bonuses.module';
import { LeaguesModule } from './leagues/leagues.module';
import { CalendarsModule } from './calendars/calendars.module';
import { EventQueueModule } from './event-queue/event-queue.module';
import { SimulationsModule } from './simulations/simulations.module';
import { ContractsModule } from './contracts/contracts.module';
import { TransfersModule } from './transfers/transfers.module';
import { LegendsModule } from './legends/legends.module';
import { AiClubsModule } from './ai-clubs/ai-clubs.module';
import { ManagerCareerModule } from './manager-career/manager-career.module';
import { InternationalsModule } from './internationals/internationals.module';

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
    ClubsModule,
    MatchesModule,
    MatchSeriesModule,
    LeaguesModule,
    CalendarsModule,
    EventQueueModule,
    SimulationsModule,
    TransfersModule,
    ContractsModule,
    LegendsModule,
    AiClubsModule,
    ManagerCareerModule,
    InternationalsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
