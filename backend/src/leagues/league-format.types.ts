import { Region } from '../careers/enums/region.enum';
import { LeagueStageFormat } from './enums/league-stage-format.enum';

export enum LeagueGroupPairingMode {
  INTRA_GROUP = 'INTRA_GROUP',
  CROSS_GROUP = 'CROSS_GROUP',
}

export interface LeagueStageSettings {
  cycles?: number;
  cyclesByGroup?: Record<string, number>;
  groupCodes?: string[];
  pairingMode?: LeagueGroupPairingMode;
  swissRounds?: number;
  qualifierCount?: number;
  description?: string;
}

export interface LeagueStageTemplate {
  code: string;
  name: string;
  format: LeagueStageFormat;
  bestOf: 1 | 3 | 5;
  settings: LeagueStageSettings;
}

export interface RegionalLeagueFormat {
  region: Region;
  splitNumber: number;
  name: string;
  expectedTeamCount: number;
  stages: LeagueStageTemplate[];
}
