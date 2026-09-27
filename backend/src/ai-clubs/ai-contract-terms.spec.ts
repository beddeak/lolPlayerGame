import { CareerPlayer } from '../careers/entities/career-player.entity';
import { buildAiContractTerms } from './ai-contract-terms';
import { estimateAiAnnualSalary } from './ai-club-budget.service';

function player(ability: number): CareerPlayer {
  return Object.assign(new CareerPlayer(), {
    currentMechanics: ability,
    currentGameSense: ability,
    currentLaning: ability,
    currentTeamFight: ability,
    currentMacro: ability,
    currentTeamPlay: ability,
    currentMental: ability,
    currentChampionPool: ability,
  });
}

describe('AI salary offers', () => {
  it('uses the same market curve as wage reservations and adds a modest premium', () => {
    expect(estimateAiAnnualSalary(player(80))).toBe(30_000);
    expect(buildAiContractTerms(player(80)).annualSalary).toBe(34_500);
  });

  it('does not compound already-high salaries on every renewal', () => {
    let current = 200_000;
    for (let year = 0; year < 10; year++) {
      current = buildAiContractTerms(player(80), current).annualSalary;
      expect(current).toBe(200_000);
    }
  });

  it('caps new offers at 40억 and preserves higher legacy contracts', () => {
    expect(buildAiContractTerms(player(119)).annualSalary).toBe(400_000);
    expect(buildAiContractTerms(player(119), 500_000).annualSalary).toBe(
      500_000,
    );
  });
});
