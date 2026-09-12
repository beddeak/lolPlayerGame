import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ManagerCareerState } from './entities/manager-career-state.entity';
import { ManagerReview } from './entities/manager-review.entity';
import { ManagerCareerService } from './manager-career.service';
import { ManagerCareerController } from './manager-career.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([ManagerCareerState, ManagerReview]),
  ],
  providers: [ManagerCareerService],
  controllers: [ManagerCareerController],
  exports: [ManagerCareerService],
})
export class ManagerCareerModule {}
