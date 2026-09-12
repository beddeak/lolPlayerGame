import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContractsModule } from '../contracts/contracts.module';
import { AiClubSupportModule } from './ai-club-support.module';
import { AiClubsController } from './ai-clubs.controller';
import { AiClubsService } from './ai-clubs.service';

@Module({
  imports: [AuthModule, ContractsModule, AiClubSupportModule],
  controllers: [AiClubsController],
  providers: [AiClubsService],
  exports: [AiClubsService],
})
export class AiClubsModule {}
