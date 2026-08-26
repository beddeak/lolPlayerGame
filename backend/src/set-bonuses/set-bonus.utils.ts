import { SetBonusResponseDto } from './dto/set-bonus-response.dto';
import { SetBonus } from './entities/set-bonus.entity';
import { SetBonusSnapshot } from './set-bonus.types';

export function findActiveSetBonuses(
  setBonuses: SetBonus[],
  playerCardIds: Iterable<number>,
): SetBonus[] {
  const playerCardIdSet = new Set(playerCardIds);

  return setBonuses.filter(
    (setBonus) =>
      setBonus.requirements.length > 0 &&
      setBonus.requirements.every((requirement) =>
        playerCardIdSet.has(requirement.playerCardId),
      ),
  );
}

export function toSetBonusResponse(setBonus: SetBonus): SetBonusResponseDto {
  return {
    id: setBonus.id,
    code: setBonus.code,
    name: setBonus.name,
    description: setBonus.description,
    requiredPlayerCardIds: setBonus.requirements
      .map((requirement) => requirement.playerCardId)
      .sort((left, right) => left - right),
    chemistryBonus: setBonus.chemistryBonus,
    laningBonus: setBonus.laningBonus,
    teamFightBonus: setBonus.teamFightBonus,
    macroBonus: setBonus.macroBonus,
    teamPlayBonus: setBonus.teamPlayBonus,
  };
}

export function toSetBonusSnapshot(setBonus: SetBonus): SetBonusSnapshot {
  return {
    id: setBonus.id,
    code: setBonus.code,
    name: setBonus.name,
    chemistryBonus: setBonus.chemistryBonus,
    laningBonus: setBonus.laningBonus,
    teamFightBonus: setBonus.teamFightBonus,
    macroBonus: setBonus.macroBonus,
    teamPlayBonus: setBonus.teamPlayBonus,
  };
}
