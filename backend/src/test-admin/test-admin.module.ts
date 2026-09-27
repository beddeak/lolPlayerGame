import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CalendarsModule } from '../calendars/calendars.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { InternationalsModule } from '../internationals/internationals.module';
import { TestAdminController } from './test-admin.controller';
import { TestAdminService } from './test-admin.service';

@Module({
  imports: [AuthModule, CalendarsModule, LeaguesModule, InternationalsModule],
  controllers: [TestAdminController],
  providers: [TestAdminService],
})
export class TestAdminModule {}
