import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Position } from '../players/enums/position.enum';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { CHAMPIONS, CHAMPIONS_BY_ID } from './champion-catalog';
import { RIOT_CHAMPIONS } from './data/riot-champions';
import {
  bestChampionAssignment,
  championMatchModifier,
  compositionValue,
} from './champion-balance';
import {
  applyDraftAction,
  automaticVariant,
  autoCompleteDraft,
  availableVariants,
  confirmChampionLineup,
  currentTurn,
  DraftState,
  DraftTeam,
  automaticSelection,
  applySelection,
} from './draft-state';
import { ChampionLineupDto } from './series-draft.controller';
import { applyVariantDraft } from './variant-match';
import { SimpleMatchTeamInput } from '../matches/simulation/simple-match.types';

const team = (id: number): DraftTeam => ({
  id,
  code: `T${id}`,
  strategy: TeamStrategy.BALANCED,
  players: Object.values(Position).map((position, i) => ({
    id: id * 10 + i,
    nickname: 'P',
    position,
    instruction: null,
    roleProficiency: null,
    typeProficiencies: {},
    abilities: { mechanics: 85, laning: 85, teamFight: 85 },
  })),
});
const state = (seed = 123): DraftState => ({
  version: 3,
  aiSeed: seed,
  blue: team(1),
  red: team(2),
  managedTeamId: 1,
  gameNumber: 1,
  fearless: true,
  unavailable: [],
  actions: [],
  completed: false,
  deadline: null,
});
const c = (id: string) => CHAMPIONS_BY_ID.get(id)!;
const drafted = () => {
  let s = state();
  while (!s.completed) s = applyDraftAction(s, automaticVariant(s).id, true, 0);
  return s;
};

describe('real champion draft and flexible assignments', () => {
  it('includes the complete pinned 173 champion official identity catalog with bounded custom profiles', () => {
    expect(CHAMPIONS).toHaveLength(173);
    expect(CHAMPIONS_BY_ID.size).toBe(RIOT_CHAMPIONS.length);
    for (const champion of CHAMPIONS) {
      expect(champion.imageUrl).toMatch(
        /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/16\.19\.1\/img\/champion\//,
      );
      expect(champion.recommendedPositions.length).toBeGreaterThan(0);
      for (const stat of [
        champion.early,
        champion.mid,
        champion.late,
        champion.lanePower,
        champion.teamFight,
        champion.scaling,
        champion.range,
        champion.engage,
        champion.frontline,
        champion.magicShare,
        champion.protection,
        champion.damage,
        champion.waveClear,
        champion.objectiveDamage,
        ...Object.values(champion.roleRatings),
      ]) {
        expect(Number.isFinite(stat)).toBe(true);
        expect(stat).toBeGreaterThanOrEqual(0);
        expect(stat).toBeLessThanOrEqual(100);
      }
    }
  });
  it('permits five marksmen on one side; picks do not lock a lane', () => {
    let s = state();
    const desired = ['Ashe', 'Jinx', 'Caitlyn', 'Draven', 'Vayne'];
    let pick = 0;
    while (!s.completed) {
      const turn = currentTurn(s)!;
      const legal = availableVariants(s).filter((x) => !desired.includes(x.id));
      const id =
        turn.kind === 'PICK' && turn.side === 'BLUE'
          ? desired[pick++]
          : legal[0].id;
      s = applyDraftAction(s, id, false, 0);
    }
    expect(pick).toBe(5);
    expect(s.assignmentsConfirmed).toBe(false);
    expect(new Set(Object.values(s.assignments!.BLUE))).toEqual(
      new Set(desired),
    );
    const entries = Object.values(Position).map((position, i) => ({
      position,
      championId: desired[i],
    }));
    const final = confirmChampionLineup(s, 'BLUE', entries, 0);
    expect(final.assignments!.BLUE.MID).toBe('Caitlyn');
    expect(final.assignmentsConfirmed).toBe(true);
    expect(final.deadline).toBeNull();
    expect(s.assignmentsConfirmed).toBe(false);
  });
  it('protects assignment integrity, revision and one-time confirmation', () => {
    const s = drafted();
    const entries = Object.entries(s.assignments!.BLUE).map(
      ([p, championId]) => ({ position: p as Position, championId }),
    );
    expect(() => confirmChampionLineup(s, 'BLUE', entries, 1)).toThrow();
    expect(() =>
      confirmChampionLineup(s, 'BLUE', entries.slice(1), 0),
    ).toThrow();
    expect(() =>
      confirmChampionLineup(
        s,
        'BLUE',
        entries.map(() => entries[0]),
        0,
      ),
    ).toThrow();
    expect(() =>
      confirmChampionLineup(
        s,
        'BLUE',
        entries.map((e, i) =>
          i === 0
            ? { ...e, championId: Object.values(s.assignments!.RED)[0] }
            : e,
        ),
        0,
      ),
    ).toThrow();
    const done = confirmChampionLineup(s, 'BLUE', entries, 0);
    expect(() => confirmChampionLineup(done, 'BLUE', entries, 1)).toThrow();
    expect(() => confirmChampionLineup(state(), 'BLUE', entries, 0)).toThrow();
  });
  it('completes five fearless sets without reusing 50 picked champions, while bans reset', () => {
    let used: string[] = [];
    for (let game = 1; game <= 5; game++) {
      const next = autoCompleteDraft(
        { ...state(), gameNumber: game, unavailable: [...used] },
        0,
      );
      expect(next.actions).toHaveLength(20);
      expect(next.assignmentsConfirmed).toBe(true);
      expect(next.actions.every((a) => !used.includes(a.variantId))).toBe(true);
      expect(new Set(next.actions.map((a) => a.variantId)).size).toBe(20);
      for (const side of ['BLUE', 'RED'] as const)
        expect(new Set(Object.values(next.assignments![side])).size).toBe(5);
      used = used.concat(
        next.actions.filter((a) => a.kind === 'PICK').map((a) => a.variantId),
      );
    }
    expect(new Set(used).size).toBe(50);
    expect(() =>
      applyDraftAction({ ...state(), unavailable: ['Ashe'] }, 'Ashe', false, 0),
    ).toThrow();
    const s = applyDraftAction(state(), 'Ashe', false, 0);
    expect(() => applyDraftAction(s, 'Ashe', false, 0)).toThrow();
  });
  it('is stable on retries but varies across series, including selection dimensions', () => {
    expect(automaticVariant(state()).id).toBe(automaticVariant(state()).id);
    const openings = new Set<string>(),
      selections = new Set<string>(),
      dimensions = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = state(seed);
      openings.add(automaticVariant(s).id);
      s.selection = {
        firstSelectionTeamId: 1,
        policy: 'RANDOM',
        choices: [],
        blueTeamId: null,
        redTeamId: null,
        firstPickTeamId: null,
        secondPickTeamId: null,
      };
      selections.add(automaticSelection(s));
      const second = applySelection(s, 'FIRST_PICK', false, 0);
      dimensions.add(automaticSelection(second));
    }
    expect(openings.size).toBeGreaterThan(1);
    expect(selections.size).toBeGreaterThan(1);
    expect(dimensions.size).toBe(2);
  });
  it('chooses sensible complete assignments without forbidding off-role choices', () => {
    const picks = ['Ornn', 'LeeSin', 'Ahri', 'Jinx', 'Lulu'].map(c);
    const assigned = bestChampionAssignment(picks, team(1));
    expect(assigned.lineup).toEqual({
      TOP: 'Ornn',
      JUNGLE: 'LeeSin',
      MID: 'Ahri',
      ADC: 'Jinx',
      SUPPORT: 'Lulu',
    });
    const oneRole = bestChampionAssignment(
      ['Jinx', 'Ashe', 'Caitlyn', 'Draven', 'Vayne'].map(c),
      team(1),
    );
    expect(Object.keys(oneRole.lineup)).toHaveLength(5);
  });
  it('applies matchup, assigned position and composition to simulation without changing base stats', () => {
    const balanced = ['Ornn', 'LeeSin', 'Ahri', 'Jinx', 'Lulu'].map(c);
    const glass = ['Jinx', 'Ashe', 'Caitlyn', 'Draven', 'Vayne'].map(c);
    expect(compositionValue(balanced)).toBeGreaterThan(compositionValue(glass));
    const normal = championMatchModifier(
      c('Jinx'),
      c('Caitlyn'),
      Position.ADC,
      TeamStrategy.BOT_CARRY,
      balanced,
      glass,
    );
    const jungle = championMatchModifier(
      c('Jinx'),
      c('Caitlyn'),
      Position.JUNGLE,
      TeamStrategy.BOT_CARRY,
      balanced,
      glass,
    );
    expect(normal).toBeGreaterThan(jungle);
    expect(
      championMatchModifier(
        c('Jinx'),
        c('Draven'),
        Position.ADC,
        TeamStrategy.BOT_CARRY,
        balanced,
        glass,
      ),
    ).not.toBe(normal);
    const s = autoCompleteDraft(state(), 0);
    const input = {
      teamId: 1,
      teamStrategy: TeamStrategy.BALANCED,
      players: Object.values(Position).map((position) => ({
        position,
        mechanics: 85,
      })),
    } as SimpleMatchTeamInput;
    const output = applyVariantDraft(input, s);
    expect(input.players.every((p) => p.variantModifier === undefined)).toBe(
      true,
    );
    for (const p of output.players) {
      expect(p.mechanics).toBe(85);
      expect(p.variantModifier).toBeGreaterThanOrEqual(-32);
      expect(p.variantModifier).toBeLessThanOrEqual(10);
    }
    expect(() =>
      applyVariantDraft(input, { ...s, assignmentsConfirmed: false }),
    ).toThrow();
  });
  it('validates lineup requests, including malformed nested payloads', async () => {
    const entries = Object.values(Position).map((position, i) => ({
      position,
      championId: CHAMPIONS[i].id,
    }));
    expect(
      await validate(
        plainToInstance(ChampionLineupDto, { expectedRevision: 0, entries }),
      ),
    ).toHaveLength(0);
    for (const body of [
      { expectedRevision: -1, entries },
      { expectedRevision: 0, entries: [] },
      {
        expectedRevision: 0,
        entries: entries.map((e) => ({ ...e, position: 'BAD' })),
      },
      {
        expectedRevision: 0,
        entries: entries.map((e) => ({ ...e, championId: 42 })),
      },
    ])
      expect(
        (await validate(plainToInstance(ChampionLineupDto, body))).length,
      ).toBeGreaterThan(0);
  });
});
