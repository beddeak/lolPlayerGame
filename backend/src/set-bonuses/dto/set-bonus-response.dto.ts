export class SetBonusResponseDto {
  id!: number;
  code!: string;
  name!: string;
  description!: string | null;
  requiredPlayerCardIds!: number[];
  chemistryBonus!: number;
  laningBonus!: number;
  teamFightBonus!: number;
  macroBonus!: number;
  teamPlayBonus!: number;
}
