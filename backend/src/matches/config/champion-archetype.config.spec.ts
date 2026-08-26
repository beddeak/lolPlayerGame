import { CHAMPION_ARCHETYPES_BY_POSITION } from '../../careers/config/champion-archetype.config';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { Position } from '../../players/enums/position.enum';
import { CHAMPION_ARCHETYPE_CONFIG } from './champion-archetype.config';

describe('Champion archetype configuration', () => {
  it('assigns every archetype to exactly one matching position', () => {
    const assignedArchetypes: ChampionArchetype[] = [];

    for (const position of Object.values(Position)) {
      const archetypes = CHAMPION_ARCHETYPES_BY_POSITION[position] ?? [];

      for (const archetype of archetypes) {
        expect(CHAMPION_ARCHETYPE_CONFIG[archetype].position).toBe(position);
        assignedArchetypes.push(archetype);
      }
    }

    expect(new Set(assignedArchetypes).size).toBe(assignedArchetypes.length);
    expect(new Set(assignedArchetypes)).toEqual(
      new Set(Object.values(ChampionArchetype)),
    );
  });
});
