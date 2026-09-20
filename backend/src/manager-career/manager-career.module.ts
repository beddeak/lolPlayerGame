import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ManagerCareerState } from './entities/manager-career-state.entity';
import { ManagerReview } from './entities/manager-review.entity';
import { ManagerCareerService } from './manager-career.service';
import { ManagerCareerController } from './manager-career.controller';
import { ManagerJobOffer } from './entities/manager-job-offer.entity';
import { ManagerJobOffersService } from './manager-job-offers.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      ManagerCareerState,
      ManagerReview,
      ManagerJobOffer,
    ]),
  ],
  providers: [ManagerCareerService, ManagerJobOffersService],
  controllers: [ManagerCareerController],
  exports: [ManagerCareerService],
})
export class ManagerCareerModule {}
