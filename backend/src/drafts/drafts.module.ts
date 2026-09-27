import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DraftCatalogController } from './draft-catalog.controller';
import { SeriesDraftController } from './series-draft.controller';

@Module({
  imports: [AuthModule],
  controllers: [DraftCatalogController, SeriesDraftController],
})
export class DraftsModule {}
