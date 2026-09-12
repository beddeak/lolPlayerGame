import { Region } from '../../careers/enums/region.enum';
import { PlayerCardResponseDto } from '../../players/dto/player-card-response.dto';
import { Position } from '../../players/enums/position.enum';

export class ClubResponseDto {
  code!: string;
  name!: string;
  region!: Region;
  logoUrl!: string | null;
  selectable!: boolean;
  unavailableReason!: string | null;
  startingStrength!: number | null;
  starters!: { position: Position; playerCard: PlayerCardResponseDto }[];
  benches!: { playerCard: PlayerCardResponseDto }[];
}

export class ClubCatalogResponseDto {
  startYear!: number;
  worldTeamCount!: number;
  ready!: boolean;
  unavailableReason!: string | null;
  clubs!: ClubResponseDto[];
}
