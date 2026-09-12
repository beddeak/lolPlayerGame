import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClubCatalogResponseDto } from './dto/club-response.dto';
import { ClubsService } from './clubs.service';

@Controller('clubs')
@UseGuards(JwtAuthGuard)
export class ClubsController {
  constructor(private readonly clubsService: ClubsService) {}

  @Get()
  findAll(): Promise<ClubCatalogResponseDto> {
    return this.clubsService.findAll();
  }
}
