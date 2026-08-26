import { Position } from '../../players/enums/position.enum';
import { ChampionArchetype } from '../enums/champion-archetype.enum';

export const CHAMPION_ARCHETYPES_BY_POSITION: Partial<
  Record<Position, readonly ChampionArchetype[]>
> = {
  [Position.TOP]: [
    ChampionArchetype.TOP_TANK,
    ChampionArchetype.TOP_AD_BRUISER,
    ChampionArchetype.TOP_AP_BRUISER,
    ChampionArchetype.TOP_SIDE_LANE,
    ChampionArchetype.TOP_VALUE,
  ],
  [Position.JUNGLE]: [
    ChampionArchetype.JUNGLE_ENGAGE,
    ChampionArchetype.JUNGLE_SCALING,
    ChampionArchetype.JUNGLE_EARLY_SNOWBALL,
  ],
  [Position.MID]: [
    ChampionArchetype.MID_ASSASSIN,
    ChampionArchetype.MID_STANDING_MAGE,
    ChampionArchetype.MID_TANK,
    ChampionArchetype.MID_AP_BRUISER,
    ChampionArchetype.MID_AD_BRUISER,
    ChampionArchetype.MID_VALUE,
  ],
  [Position.ADC]: [
    ChampionArchetype.LANE_BULLY,
    ChampionArchetype.HYPER_CARRY,
    ChampionArchetype.WEAKSIDE_SAFE,
  ],
  [Position.SUPPORT]: [
    ChampionArchetype.GRAB,
    ChampionArchetype.UTILITY,
    ChampionArchetype.TANK_ENGAGE,
  ],
};

export function isChampionArchetypeAllowed(
  position: Position,
  archetype: ChampionArchetype,
): boolean {
  return (
    CHAMPION_ARCHETYPES_BY_POSITION[position]?.includes(archetype) ?? false
  );
}
