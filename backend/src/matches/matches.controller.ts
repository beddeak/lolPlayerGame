import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { MatchSimulationResponseDto } from './dto/match-simulation-response.dto';
import { SimulateMatchDto } from './dto/simulate-match.dto';
import { MatchesService } from './matches.service';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Post('simulate')
  simulate(@Body() dto: SimulateMatchDto): Promise<MatchSimulationResponseDto> {
    return this.matchesService.simulate(dto);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MatchSimulationResponseDto> {
    return this.matchesService.findOne(id);
  }
}
