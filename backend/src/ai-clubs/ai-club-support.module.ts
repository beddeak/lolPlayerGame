import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiClubState } from './entities/ai-club-state.entity';
import { AiClubBudgetService } from './ai-club-budget.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiClubState])],
  providers: [AiClubBudgetService],
  exports: [AiClubBudgetService],
})
export class AiClubSupportModule {}
