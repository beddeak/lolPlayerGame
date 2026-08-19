import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class QueryPlayerCardDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  playerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  themeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  cardYear?: number;
}
