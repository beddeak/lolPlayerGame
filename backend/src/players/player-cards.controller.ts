import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CreatePlayerCardDto } from './dto/create-player-card.dto';
import { PlayerCardResponseDto } from './dto/player-card-response.dto';
import { QueryPlayerCardDto } from './dto/query-player-card.dto';
import { PlayerCardsService } from './player-cards.service';

@Controller('player-cards')
export class PlayerCardsController {
  constructor(private readonly playerCardsService: PlayerCardsService) {}

  @Post()
  create(@Body() dto: CreatePlayerCardDto): Promise<PlayerCardResponseDto> {
    return this.playerCardsService.create(dto);
  }

  @Get()
  findAll(
    @Query() query: QueryPlayerCardDto,
  ): Promise<PlayerCardResponseDto[]> {
    return this.playerCardsService.findAll(query);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PlayerCardResponseDto> {
    return this.playerCardsService.findOne(id);
  }
}
