import { BadRequestException, ConflictException } from '@nestjs/common';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { PLAYER_CARD_STAT_MAX } from '../players/constants/player-card.constants';

export const TEST_PLAYER_FIELDS = {
  currentMechanics: PLAYER_CARD_STAT_MAX,
  currentGameSense: PLAYER_CARD_STAT_MAX,
  currentLaning: PLAYER_CARD_STAT_MAX,
  currentTeamFight: PLAYER_CARD_STAT_MAX,
  currentMacro: PLAYER_CARD_STAT_MAX,
  currentTeamPlay: PLAYER_CARD_STAT_MAX,
  currentMental: PLAYER_CARD_STAT_MAX,
  currentChampionPool: PLAYER_CARD_STAT_MAX,
  form: 100,
  condition: 100,
  coachTrust: 100,
} as const;
export type TestPlayerField = keyof typeof TEST_PLAYER_FIELDS;

export function validateTestStats(
  values: Record<string, number>,
  expected: Record<string, number>,
) {
  const keys = Object.keys(values ?? {});
  if (
    !keys.length ||
    keys.length > Object.keys(TEST_PLAYER_FIELDS).length ||
    keys.length !== Object.keys(expected ?? {}).length
  )
    throw new BadRequestException(
      '수정할 능력치와 변경 전 값을 함께 보내 주세요.',
    );
  for (const key of keys) {
    if (!Object.hasOwn(TEST_PLAYER_FIELDS, key))
      throw new BadRequestException('수정할 수 없는 능력치입니다.');
    const max = TEST_PLAYER_FIELDS[key as TestPlayerField];
    for (const value of [values[key], expected[key]]) {
      if (!Number.isInteger(value) || value < 0 || value > max)
        throw new BadRequestException(`${key}: 0~${max} 정수만 가능합니다.`);
    }
  }
  return keys as TestPlayerField[];
}

export function applyTestStats(
  player: CareerPlayer,
  values: Record<string, number>,
  expected: Record<string, number>,
) {
  const keys = validateTestStats(values, expected);
  if (keys.some((key) => player[key] !== expected[key]))
    throw new ConflictException(
      '선수 상태가 다른 작업에서 변경됐습니다. 다시 불러온 뒤 수정해 주세요.',
    );
  for (const key of keys) player[key] = values[key];
}

export function assertTestTarget(currentDate: string, targetDate: string) {
  if (targetDate !== `${currentDate.slice(0, 4)}-11-19`)
    throw new BadRequestException(
      '올해 11월 19일 이적시장까지만 자동 진행할 수 있습니다.',
    );
}
