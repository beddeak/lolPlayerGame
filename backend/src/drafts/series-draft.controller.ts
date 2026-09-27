import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Position } from '../players/enums/position.enum';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentAccount } from '../auth/current-account.decorator';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { readSeriesDraft, updateSeriesDraft } from './series-draft.store';
import type { SelectionChoice } from './draft-state';

export class DraftActionDto {
  @IsInt() @Min(0) @Max(19) expectedStep!: number;
  @IsOptional() @IsString() @MaxLength(80) variantId?: string;
}
export class FirstSelectionDto {
  @IsInt() @Min(0) @Max(1) expectedStep!: number;
  @IsOptional()
  @IsIn(['BLUE', 'RED', 'FIRST_PICK', 'SECOND_PICK'])
  choice?: SelectionChoice;
}

export class ChampionLineupEntryDto {
  @IsEnum(Position) position!: Position;
  @IsString() @MaxLength(80) championId!: string;
}
export class ChampionLineupDto {
  @IsInt() @Min(0) @Max(1000) expectedRevision!: number;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ChampionLineupEntryDto)
  entries?: ChampionLineupEntryDto[];
}

@Controller('match-series/:id/drafts/:game')
@UseGuards(JwtAuthGuard)
export class SeriesDraftController {
  constructor(private readonly db: DataSource) {}
  @Get()
  read(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Param('game', ParseIntPipe) game: number,
  ) {
    return readSeriesDraft(this.db, account.id, id, game);
  }
  @Post()
  prepare(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Param('game', ParseIntPipe) game: number,
  ) {
    return updateSeriesDraft(this.db, account.id, id, game);
  }
  @Post('actions')
  act(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Param('game', ParseIntPipe) game: number,
    @Body() dto: DraftActionDto,
  ) {
    return updateSeriesDraft(this.db, account.id, id, game, dto);
  }
  @Post('selection')
  select(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Param('game', ParseIntPipe) game: number,
    @Body() dto: FirstSelectionDto,
  ) {
    return updateSeriesDraft(this.db, account.id, id, game, {
      expectedStep: 0,
      selection: dto,
    });
  }
  @Post('lineup')
  lineup(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('id', ParseIntPipe) id: number,
    @Param('game', ParseIntPipe) game: number,
    @Body() dto: ChampionLineupDto,
  ) {
    return updateSeriesDraft(this.db, account.id, id, game, {
      expectedStep: 20,
      lineup: dto,
    });
  }
}
