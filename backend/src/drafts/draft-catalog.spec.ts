import {
  CHAMPION_TYPES,
  CHAMPION_VARIANTS,
  VARIANTS_BY_ID,
} from './variant-catalog';
import { DraftCatalogController } from './draft-catalog.controller';
import {
  DRAFT_TURNS,
  autoCompleteDraft,
  availableVariants,
  DraftState,
} from './draft-state';
import { Position } from '../players/enums/position.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';

describe('draft catalog and selection foundation', () => {
  it('provides all 31 requested types and 81 unique numeric variants', () => {
    expect(CHAMPION_TYPES).toHaveLength(31);
    expect(CHAMPION_VARIANTS).toHaveLength(81);
    expect(VARIANTS_BY_ID.size).toBe(81);
    for (const value of CHAMPION_VARIANTS) {
      for (const stat of [
        value.early,
        value.mid,
        value.late,
        value.lanePower,
        value.teamFight,
        value.scaling,
        value.range,
        value.engage,
        value.frontline,
      ]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThanOrEqual(0);
        expect(stat).toBeLessThanOrEqual(100);
      }
    }
  });
  it('keeps the three requested LaneBully curves', () => {
    expect(VARIANTS_BY_ID.get('ADC_LANE_BULLY_A')).toMatchObject({
      early: 100,
      mid: 82,
      late: 48,
      lanePower: 100,
      teamFight: 65,
      scaling: 45,
    });
    expect(VARIANTS_BY_ID.get('ADC_LANE_BULLY_B')).toMatchObject({
      early: 93,
      mid: 88,
      late: 72,
    });
    expect(VARIANTS_BY_ID.get('ADC_LANE_BULLY_C')).toMatchObject({
      early: 87,
      mid: 91,
      late: 84,
    });
  });
  it('exposes a read-only 30-second 20-turn catalog with 5 bans and 5 picks each', () => {
    const result = new DraftCatalogController().catalog();
    expect(result.turnSeconds).toBe(30);
    expect(result.turns.map((turn) => turn.side[0]).join('')).toBe(
      'BRBRBRBRRBBRRBRBRBBR',
    );
    for (const side of ['BLUE', 'RED'])
      for (const kind of ['PICK', 'BAN']) {
        expect(
          DRAFT_TURNS.filter(
            (turn) => turn.side === side && turn.kind === kind,
          ),
        ).toHaveLength(5);
      }
    expect(JSON.stringify(result)).not.toMatch(/potential|typeProficiencies/);
  });
  it('never exhausts a position even over five sets of a small fearless pool', () => {
    const team = (id: number) => ({
      id,
      code: `T${id}`,
      strategy: TeamStrategy.BALANCED,
      players: Object.values(Position).map((position, i) => ({
        id: id * 10 + i,
        nickname: 'test',
        position,
        instruction: null,
        roleProficiency: null,
        typeProficiencies: {},
      })),
    });
    const unavailable: string[] = [];
    for (let gameNumber = 1; gameNumber <= 5; gameNumber++) {
      const state: DraftState = {
        version: 1,
        blue: team(1),
        red: team(2),
        managedTeamId: 1,
        gameNumber,
        fearless: true,
        unavailable: [...unavailable],
        actions: [],
        completed: false,
        deadline: null,
      };
      const snapshot = JSON.stringify(state);
      const result = autoCompleteDraft(state, 0);
      expect(JSON.stringify(state)).toBe(snapshot);
      expect(result.actions).toHaveLength(20);
      expect(
        new Set(result.actions.map((action) => action.variantId)).size,
      ).toBe(20);
      expect(availableVariants(result)).toHaveLength(0);
      for (const side of ['BLUE', 'RED']) {
        const picks = result.actions.filter(
          (action) => action.side === side && action.kind === 'PICK',
        );
        expect(
          new Set(
            picks.map((pick) => VARIANTS_BY_ID.get(pick.variantId)!.position),
          ).size,
        ).toBe(5);
      }
      unavailable.push(
        ...result.actions
          .filter((action) => action.kind === 'PICK')
          .map((action) => action.variantId),
      );
    }
  });
});
