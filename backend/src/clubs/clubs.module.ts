import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClubRoster } from './entities/club-roster.entity';
import { Club } from './entities/club.entity';
import { ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Club, ClubRoster])],
  controllers: [ClubsController],
  providers: [ClubsService],
})
export class ClubsModule {}
