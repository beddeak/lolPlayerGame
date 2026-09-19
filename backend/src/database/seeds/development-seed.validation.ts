import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DEFAULT_CAREER_START_YEAR } from '../../careers/constants/career.constants';
import { PLAYER_CARD_BASE_STAT_FIELDS } from '../../players/constants/player-card.constants';
import { CreatePlayerCardDto } from '../../players/dto/create-player-card.dto';
import { CreatePlayerDto } from '../../players/dto/create-player.dto';
import { CreateThemeDto } from '../../players/dto/create-theme.dto';
import { CreateSetBonusDto } from '../../set-bonuses/dto/create-set-bonus.dto';
import { validateClubSeeds } from './club-catalog.seed';
import type { ClubSeedData } from './club-catalog.seed';
import { DEVELOPMENT_PLAYER_DEFAULTS } from './development-seed.types';
import type { DevelopmentSeedData } from './development-seed.types';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const identity = (values: unknown[]) =>
  JSON.stringify(
    values.map((value) =>
      typeof value === 'string'
        ? value.trim().toLocaleLowerCase('en-US')
        : value,
    ),
  );

/** Pure preflight shared by seed:check and the importer; never connects to a DB. */
export function validateDevelopmentSeed(value: unknown): DevelopmentSeedData {
  if (!record(value)) throw new Error('Seed must be a JSON object');
  const errors: string[] = [];
  const checkDto = <T extends object>(
    type: new () => T,
    fields: Record<string, unknown>,
    at: string,
  ) => {
    for (const error of validateSync(plainToInstance(type, fields))) {
      errors.push(
        `${at}.${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
      );
    }
  };
  const text = (field: unknown, at: string) => {
    if (typeof field !== 'string' || !field.trim() || field !== field.trim()) {
      errors.push(
        `${at}: a non-empty string without surrounding whitespace is required`,
      );
      return false;
    }
    return true;
  };
  const list = (name: string): unknown[] => {
    if (!Array.isArray(value[name])) {
      errors.push(`${name}: an array is required`);
      return [];
    }
    return value[name] as unknown[];
  };
  const unique = (seen: Set<string>, key: unknown, at: string) => {
    if (!text(key, at)) return;
    const normalized = identity([key]);
    if (seen.has(normalized))
      errors.push(`${at}: duplicate value ${String(key)}`);
    seen.add(normalized);
  };
  if (
    !Number.isInteger(value.startYear) ||
    Number(value.startYear) < DEFAULT_CAREER_START_YEAR ||
    Number(value.startYear) > 9999
  ) {
    errors.push(
      `startYear: an integer between ${DEFAULT_CAREER_START_YEAR} and 9999 is required`,
    );
  }
  const themes = list('themes'),
    cards = list('playerCards'),
    teams = list('teams'),
    bonuses = list('setBonuses');
  if (!themes.length) errors.push('themes: at least one theme is required');
  if (!cards.length) errors.push('playerCards: at least one card is required');
  const themeCodes = new Set<string>(),
    themeIdentities = new Set<string>(),
    cardKeys = new Set<string>();
  const storedCards = new Set<string>(),
    keyIdentities = new Set<string>();
  const playersByKey = new Map<string, string>();
  for (const [index, theme] of themes.entries()) {
    const at = `themes[${index}]`;
    if (!record(theme)) {
      errors.push(`${at}: an object is required`);
      continue;
    }
    checkDto(CreateThemeDto, theme, at);
    unique(themeIdentities, theme.code, `${at}.code`);
    text(theme.name, `${at}.name`);
    if (typeof theme.code === 'string') themeCodes.add(theme.code);
  }
  for (const [index, card] of cards.entries()) {
    const at = `playerCards[${index}]${typeof (card as Record<string, unknown>)?.key === 'string' ? ` (${String((card as Record<string, unknown>).key)})` : ''}`;
    if (!record(card)) {
      errors.push(`${at}: an object is required`);
      continue;
    }
    unique(keyIdentities, card.key, `${at}.key`);
    text(card.nickname, `${at}.nickname`);
    text(card.themeCode, `${at}.themeCode`);
    const nationality =
      card.nationality === undefined
        ? DEVELOPMENT_PLAYER_DEFAULTS.nationality
        : card.nationality;
    text(nationality, `${at}.nationality`);
    checkDto(CreatePlayerDto, { nickname: card.nickname, nationality }, at);
    checkDto(
      CreatePlayerCardDto,
      {
        ...card,
        playerId: 1,
        themeId: 1,
        startingAge:
          card.startingAge === undefined
            ? DEVELOPMENT_PLAYER_DEFAULTS.startingAge
            : card.startingAge,
        potential:
          card.potential === undefined
            ? Math.max(
                ...PLAYER_CARD_BASE_STAT_FIELDS.map((stat) =>
                  Number(card[stat]),
                ),
              )
            : card.potential,
      },
      at,
    );
    if (!themeCodes.has(String(card.themeCode)))
      errors.push(`${at}.themeCode: unknown theme ${String(card.themeCode)}`);
    const storedIdentity = identity([
      card.nickname,
      nationality,
      card.themeCode,
      card.cardYear,
    ]);
    if (storedCards.has(storedIdentity))
      errors.push(`${at}: duplicate player/theme/year card identity`);
    storedCards.add(storedIdentity);
    if (typeof card.key === 'string' && card.key.trim()) {
      cardKeys.add(card.key);
      playersByKey.set(card.key, identity([card.nickname, nationality]));
    }
  }
  try {
    validateClubSeeds(teams as ClubSeedData[], cardKeys);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid team data');
  }
  const activePlayers = new Set<string>();
  for (const team of teams) {
    if (
      !record(team) ||
      team.enabled === false ||
      !Array.isArray(team.starters)
    )
      continue;
    const starters = team.starters as unknown[];
    const benches = Array.isArray(team.benches)
      ? (team.benches as unknown[])
      : [];
    for (const slot of [...starters, ...benches]) {
      if (!record(slot)) continue;
      const player = playersByKey.get(String(slot.playerCardKey));
      if (!player) continue;
      if (activePlayers.has(player))
        errors.push(
          `${String(team.code)}: same player registered in multiple active slots (${String(slot.playerCardKey)})`,
        );
      activePlayers.add(player);
    }
  }
  const bonusCodes = new Set<string>();
  for (const [index, bonus] of bonuses.entries()) {
    const at = `setBonuses[${index}]`;
    if (!record(bonus)) {
      errors.push(`${at}: an object is required`);
      continue;
    }
    unique(bonusCodes, bonus.code, `${at}.code`);
    text(bonus.name, `${at}.name`);
    const keys = bonus.requiredPlayerCardKeys;
    if (!Array.isArray(keys))
      errors.push(`${at}.requiredPlayerCardKeys: an array is required`);
    else if (
      new Set(keys).size !== keys.length ||
      keys.some((key) => typeof key !== 'string' || !cardKeys.has(key))
    ) {
      errors.push(
        `${at}.requiredPlayerCardKeys: unknown or duplicate card reference`,
      );
    }
    checkDto(
      CreateSetBonusDto,
      {
        ...bonus,
        requiredPlayerCardIds: Array.isArray(keys)
          ? keys.map((_, index) => index + 1)
          : keys,
      },
      at,
    );
  }
  if (
    value.managedTeamCode !== undefined &&
    (typeof value.managedTeamCode !== 'string' ||
      !teams.some(
        (team) => record(team) && team.code === value.managedTeamCode,
      ))
  ) {
    errors.push(
      'managedTeamCode: must reference an existing team; omit it for catalog-only seeding',
    );
  }
  if (errors.length)
    throw new Error(
      `Invalid development seed:\n${errors.map((error) => `- ${error}`).join('\n')}`,
    );
  return value as unknown as DevelopmentSeedData;
}
