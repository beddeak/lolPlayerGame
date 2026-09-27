import { IsInt, IsOptional, Max, Min } from 'class-validator';
export class SimulateDraftGameDto {
  @IsOptional() @IsInt() @Min(1) @Max(5) gameNumber?: number;
}
