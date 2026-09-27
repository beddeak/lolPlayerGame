import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { SimpleMatchSimulationService } from '../matches/simulation/simple-match-simulation.service';
import { MatchStatsSimulationService } from '../matches/simulation/match-stats-simulation.service';
import { SimpleMatchTeamInput } from '../matches/simulation/simple-match.types';
import { calculatePostMatchPlayerState } from '../matches/simulation/player-match-state';
import {
  applyNextSetFeedback,
  FeedbackReaction,
  StoredFeedbackForSet,
} from './next-set-feedback';

describe('Next-set feedback application', () => {
  const team = (id = 1): SimpleMatchTeamInput => ({
    teamId: id,
    teamCode: `TEAM${id}`,
    teamStrategy: TeamStrategy.BOT_CARRY,
    strategyProficiency: 50,
    chemistry: 50,
    activeSetBonuses: [],
    players: STARTER_POSITIONS.map((position, i) => ({
      careerPlayerId: id * 10 + i,
      position,
      playerInstruction: null,
      roleProficiency: null,
      positionProficiency: 100,
      championArchetype: null,
      form: 50,
      condition: 100,
      mechanics: 80,
      gameSense: 80,
      laning: 80,
      teamFight: 80,
      macro: 80,
      teamPlay: 80,
      mental: 80,
      championPool: 80,
    })),
  });
  const reaction: FeedbackReaction = {
    version: 1,
    mental: 2,
    form: 2,
    confidence: 7,
    motivation: 5,
    pressure: 0,
    aggression: 8,
    riskTaking: 3,
    carryBonus: 2,
    acceptance: 90,
    chemistry: -2,
    text: 'test',
  };
  const talk = (id = 1): StoredFeedbackForSet => ({
    id,
    afterGameNumber: 1,
    targetTeamId: 1,
    effects: [{ careerPlayerId: 13, reaction }],
  });

  it('is optional, applies only to the next set and correct team, ignores legacy effects', () => {
    const original = team();
    expect(applyNextSetFeedback(original, [], 2)).toBe(original);
    expect(applyNextSetFeedback(original, [talk()], 3)).toBe(original);
    expect(
      applyNextSetFeedback(team(2), [talk()], 2).players.every(
        (p) => !p.feedback,
      ),
    ).toBe(true);
    expect(
      applyNextSetFeedback(
        original,
        [{ ...talk(), effects: [{ careerPlayerId: 13, reaction: null }] }],
        2,
      ),
    ).toBe(original);
  });

  it('combines the two talks only for participating targets without mutating their base stats', () => {
    const original = team();
    const copy = structuredClone(original);
    const next = applyNextSetFeedback(original, [talk(), talk(2)], 2);
    expect(next.players.filter((p) => p.feedback)).toHaveLength(1);
    expect(next.players[3].feedback).toMatchObject({
      mental: 4,
      form: 4,
      carryBonus: 4,
    });
    expect(next.chemistry).toBe(46);
    expect(original).toEqual(copy);
    expect(next.players[3].mental).toBe(80);
    expect(next.players[3].condition).toBe(100);
    original.players[3].careerPlayerId = 99; // Benched before next set.
    const replaced = applyNextSetFeedback(original, [talk()], 2);
    expect(replaced.players.every((p) => !p.feedback)).toBe(true);
    expect(replaced.chemistry).toBe(50);
  });

  it('requires a carry role for the carry-role bonus and survives JSON persistence', () => {
    const balanced = { ...team(), teamStrategy: TeamStrategy.BALANCED };
    expect(
      applyNextSetFeedback(balanced, [talk()], 2).players[3].feedback
        ?.carryBonus,
    ).toBe(0);
    const restored = JSON.parse(
      JSON.stringify([talk()]),
    ) as StoredFeedbackForSet[];
    expect(applyNextSetFeedback(team(), restored, 2)).toEqual(
      applyNextSetFeedback(team(), [talk()], 2),
    );
  });

  it('affects actual simulation and individual statistics, not just a message, and can change winners', () => {
    const simulation = new SimpleMatchSimulationService();
    const stats = new MatchStatsSimulationService();
    const original = team(),
      opponent = team(2);
    const feedback = {
      ...talk(),
      effects: original.players.map((p) => ({
        careerPlayerId: p.careerPlayerId,
        reaction: { ...reaction, chemistry: 0 },
      })),
    };
    const next = applyNextSetFeedback(original, [feedback], 2);
    const plain = simulation.simulate(
      original,
      opponent,
      42,
      TeamStrategy.BALANCED,
    );
    const changed = simulation.simulate(
      next,
      opponent,
      42,
      TeamStrategy.BALANCED,
    );
    expect(changed.teams[0].performance).toBeGreaterThan(
      plain.teams[0].performance,
    );
    expect(changed.teams[1]).toEqual(plain.teams[1]);
    const plainStats = stats.simulate(original, opponent, plain, 42);
    const changedStats = stats.simulate(next, opponent, changed, 42);
    expect(changedStats.teams[0].playerStats[3].feedback).toBeTruthy();
    expect(changedStats.teams[0].playerStats[3].dpm).not.toBe(
      plainStats.teams[0].playerStats[3].dpm,
    );
    expect(
      Array.from({ length: 100 }, (_, seed) => seed).some(
        (seed) =>
          simulation.simulate(original, opponent, seed, TeamStrategy.BALANCED)
            .winnerTeamId !==
          simulation.simulate(next, opponent, seed, TeamStrategy.BALANCED)
            .winnerTeamId,
      ),
    ).toBe(true);
    expect(calculatePostMatchPlayerState(next.players[3], 7, 30, true)).toEqual(
      calculatePostMatchPlayerState(original.players[3], 7, 30, true),
    );
  });
});
