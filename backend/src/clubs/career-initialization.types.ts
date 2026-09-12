import {
  CreateCareerDto,
  CreateCareerTeamDto,
} from '../careers/dto/create-career.dto';
import { ChampionArchetype } from '../careers/enums/champion-archetype.enum';

interface InitialPlayerState {
  initialCoachTrust?: number | null;
  initialForm?: number | null;
  championArchetype?: ChampionArchetype | null;
}

export interface CareerInitializationTeam extends CreateCareerTeamDto {
  clubCode?: string | null;
  logoUrl?: string | null;
  initialChemistry?: number | null;
  starters: (CreateCareerTeamDto['starters'][number] & InitialPlayerState)[];
  benches?: (NonNullable<CreateCareerTeamDto['benches']>[number] &
    InitialPlayerState)[];
}

// These values are built from the trusted catalog; they are never an HTTP DTO.
export interface CareerInitialization extends CreateCareerDto {
  autoSchedule?: boolean;
  teams: CareerInitializationTeam[];
}
