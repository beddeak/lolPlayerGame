import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CareersModule } from '../careers/careers.module';
import { CalendarsModule } from '../calendars/calendars.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { SeasonSkipController } from './season-skip.controller';
import { SeasonSkipService } from './season-skip.service';
@Module({
  imports: [AuthModule, CareersModule, CalendarsModule, LeaguesModule],
  controllers: [SeasonSkipController],
  providers: [SeasonSkipService],
})
export class SeasonSkipModule {}
