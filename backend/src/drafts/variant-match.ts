import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { SimpleMatchTeamInput } from '../matches/simulation/simple-match.types';
import { DraftState, selectedVariants } from './draft-state';
import { ChampionVariant } from './variant-catalog';
import { CHAMPIONS_BY_ID } from './champion-catalog';
import { championMatchModifier } from './champion-balance';

// Small, bounded modifiers; no invented champion mastery or stored stat growth.
export function variantMatchModifier(
  pick: ChampionVariant,
  opponent: ChampionVariant,
  strategy: TeamStrategy,
) {
  const early = /PRESSURE|UPPER|TOP_CARRY/.test(strategy);
  const late = strategy === TeamStrategy.BOT_CARRY;
  const strength =
    pick.early * (early ? 0.5 : 0.25) +
    pick.mid * 0.3 +
    pick.late * (early ? 0.2 : 0.45);
  const curve = (strength - 80) * 0.12;
  const lane = (pick.lanePower - opponent.lanePower) * 0.025;
  const reach = (pick.range - opponent.range) * 0.008;
  const engage =
    (pick.engage * opponent.range - opponent.engage * pick.range) * 0.00012;
  const plan =
    ((late ? pick.scaling : early ? pick.lanePower : pick.teamFight) - 80) *
    0.04;
  return Math.max(-5, Math.min(5, curve + lane + reach + engage + plan));
}

export function applyVariantDraft(
  team: SimpleMatchTeamInput,
  draft: DraftState,
): SimpleMatchTeamInput {
  const side = team.teamId === draft.blue.id ? 'BLUE' : 'RED';
  if (draft.version === 3) {
    if (!draft.completed || !draft.assignmentsConfirmed || !draft.assignments)
      throw new Error('챔피언 배치를 먼저 확정해 주세요.');
    const own = draft.assignments[side],
      enemy = draft.assignments[side === 'BLUE' ? 'RED' : 'BLUE'];
    const picks = Object.values(own).map((id) => CHAMPIONS_BY_ID.get(id)!);
    const opposing = Object.values(enemy).map((id) => CHAMPIONS_BY_ID.get(id)!);
    if (
      picks.length !== 5 ||
      opposing.length !== 5 ||
      [...picks, ...opposing].some((c) => !c)
    )
      throw new Error('Invalid champion lineup');
    return {
      ...team,
      players: team.players.map((player) => ({
        ...player,
        championArchetype: null,
        variantModifier: championMatchModifier(
          CHAMPIONS_BY_ID.get(own[player.position])!,
          CHAMPIONS_BY_ID.get(enemy[player.position])!,
          player.position,
          team.teamStrategy,
          picks,
          opposing,
        ),
      })),
    };
  }
  const ours = selectedVariants(draft, side);
  const theirs = selectedVariants(draft, side === 'BLUE' ? 'RED' : 'BLUE');
  return {
    ...team,
    players: team.players.map((player) => {
      const pick = ours.find((variant) => variant.position === player.position);
      const opponent = theirs.find(
        (variant) => variant.position === player.position,
      );
      if (!pick || !opponent)
        throw new Error('Incomplete draft cannot be simulated');
      return {
        ...player,
        championArchetype: null,
        variantModifier: variantMatchModifier(
          pick,
          opponent,
          team.teamStrategy,
        ),
      };
    }),
  };
}
