import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClubCatalogResponseDto } from './dto/club-response.dto';
import { readClubCatalog, toClubCatalogResponse } from './club-catalog';

@Injectable()
export class ClubsService {
  constructor(private readonly dataSource: DataSource) {}

  async findAll(): Promise<ClubCatalogResponseDto> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) =>
      toClubCatalogResponse(await readClubCatalog(manager)),
    );
  }
}
