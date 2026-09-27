import { Position } from '../players/enums/position.enum';
import type { ChampionVariant } from './variant-catalog';
import { RIOT_CHAMPIONS, RIOT_DATA_VERSION } from './data/riot-champions';

export interface Champion extends ChampionVariant {
  championKey: string;
  title: string;
  imageUrl: string;
  tags: string[];
  recommendedPositions: Position[];
  roleRatings: Record<Position, number>;
  magicShare: number;
  protection: number;
  difficulty: number;
  damage: number;
  waveClear: number;
  objectiveDamage: number;
}

// Recommendation/ratings are OUR editable simulation balance, not Riot lane restrictions,
// win rates, player mastery or live-patch strength. Every champion is legal in every lane.
const recommendations: Record<Position, string> = {
  TOP: 'Aatrox Akali Ambessa Aurora Camille Chogath Darius DrMundo Fiora Gangplank Garen Gnar Gragas Gwen Heimerdinger Illaoi Irelia Jax Jayce Kayle Kennen Kled KSante Malphite Mordekaiser Nasus Olaf Ornn Pantheon Poppy Quinn Renekton Rengar Riven Rumble Ryze Sett Shen Singed Sion TahmKench Teemo Trundle Tryndamere Udyr Urgot Vayne Vladimir Volibear Warwick Yasuo Yone Yorick Zaahen',
  JUNGLE:
    'Amumu Belveth Brand Briar Diana Ekko Elise Evelynn Fiddlesticks Graves Gragas Gwen Hecarim Ivern JarvanIV Jax Karthus Kayn Khazix Kindred LeeSin Lillia MasterYi MonkeyKing Morgana Naafiri Nidalee Nocturne Nunu Olaf Pantheon Poppy Qiyana Rammus RekSai Rengar Sejuani Shaco Shyvana Skarner Sylas Taliyah Talon Trundle Udyr Vi Viego Volibear Warwick XinZhao Zac Zaahen Zyra',
  MID: 'Ahri Akali Akshan Anivia Annie AurelionSol Aurora Azir Brand Cassiopeia Chogath Corki Diana Ekko Fizz Galio Gragas Heimerdinger Hwei Irelia Jayce Karma Kassadin Katarina Kennen Leblanc Lissandra Locke Lucian Lux Malphite Malzahar Mel Naafiri Neeko Orianna Pantheon Qiyana Ryze Seraphine Smolder Swain Sylas Syndra Taliyah Talon Tristana TwistedFate Varus Veigar Velkoz Vex Viktor Vladimir Xerath Yasuo Yone Zed Ziggs Zilean Zoe',
  ADC: 'Aphelios Ashe Caitlyn Corki Draven Ezreal Jhin Jinx Kaisa Kalista KogMaw Lucian MissFortune Nilah Samira Senna Seraphine Sivir Smolder Swain Tristana Twitch Varus Vayne Veigar Xayah Yasuo Yunara Zeri Ziggs',
  SUPPORT:
    'Alistar Amumu Ashe Bard Blitzcrank Brand Braum Galio Heimerdinger Hwei Ivern Janna Karma Leona Lulu Lux Maokai Milio Morgana Nami Nautilus Neeko Poppy Pyke Rakan Rell Renata Senna Seraphine Shaco Shen Sona Soraka Swain TahmKench Taric Thresh Velkoz Xerath Yuumi Zilean Zyra',
};
const recommended = Object.fromEntries(
  Object.entries(recommendations).map(([p, ids]) => [
    p,
    new Set(ids.split(' ')),
  ]),
) as Record<Position, Set<string>>;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
type Curve = Pick<
  Champion,
  | 'early'
  | 'mid'
  | 'late'
  | 'lanePower'
  | 'teamFight'
  | 'scaling'
  | 'engage'
  | 'frontline'
  | 'protection'
  | 'magicShare'
>;
// Explicit identity adjustments complement the class/stat-derived initial profiles.
const overrides: Record<string, Partial<Curve>> = {
  Azir: {
    early: 57,
    mid: 83,
    late: 97,
    scaling: 98,
    teamFight: 94,
    engage: 66,
  },
  AurelionSol: { early: 40, late: 99, scaling: 100, teamFight: 98 },
  Kayle: { early: 36, mid: 66, late: 100, scaling: 100, magicShare: 65 },
  Kassadin: { early: 42, mid: 78, late: 98, scaling: 99 },
  Smolder: { early: 46, mid: 70, late: 99, scaling: 100, magicShare: 25 },
  Nasus: { early: 44, mid: 83, late: 92, scaling: 98 },
  Veigar: { early: 50, late: 96, scaling: 100, engage: 65 },
  Draven: { early: 96, mid: 87, late: 77, lanePower: 98, scaling: 72 },
  Caitlyn: { early: 93, mid: 72, late: 90, lanePower: 97, scaling: 86 },
  Kalista: {
    early: 94,
    mid: 86,
    late: 67,
    lanePower: 93,
    scaling: 64,
    engage: 70,
  },
  Lucian: { early: 92, mid: 90, late: 73, lanePower: 93, scaling: 73 },
  Jinx: { early: 61, mid: 80, late: 99, scaling: 99, teamFight: 96 },
  Vayne: { early: 54, mid: 80, late: 98, scaling: 98, teamFight: 79 },
  KogMaw: { early: 53, mid: 81, late: 98, scaling: 98, magicShare: 48 },
  LeeSin: { early: 96, mid: 91, late: 62, scaling: 58, engage: 88 },
  Elise: { early: 95, mid: 83, late: 56, scaling: 53, magicShare: 92 },
  Nidalee: { early: 92, mid: 86, late: 62, scaling: 59, magicShare: 92 },
  RekSai: { early: 95, mid: 86, late: 61, scaling: 58 },
  Renekton: { early: 94, mid: 88, late: 64, scaling: 60, lanePower: 95 },
  Jayce: { early: 89, mid: 95, late: 74, lanePower: 92, magicShare: 15 },
  Fiora: { teamFight: 51, late: 94, scaling: 95, engage: 29 },
  Tryndamere: { teamFight: 47, late: 89, scaling: 90, engage: 35 },
  Yorick: { teamFight: 52, late: 90, scaling: 92, engage: 26 },
  Malphite: {
    early: 56,
    teamFight: 96,
    engage: 99,
    frontline: 95,
    magicShare: 85,
  },
  Ornn: {
    early: 61,
    late: 95,
    scaling: 96,
    teamFight: 96,
    engage: 96,
    frontline: 99,
  },
  Rell: { teamFight: 94, engage: 99, frontline: 91, magicShare: 90 },
  Leona: { engage: 98, frontline: 94, protection: 65, magicShare: 90 },
  Alistar: { engage: 96, frontline: 97, protection: 76, magicShare: 90 },
  Nautilus: { engage: 98, frontline: 88, protection: 62, magicShare: 88 },
  Braum: { engage: 63, frontline: 91, protection: 99, magicShare: 70 },
  Janna: { engage: 30, frontline: 12, protection: 99 },
  Lulu: { engage: 38, frontline: 12, protection: 99 },
  Milio: { engage: 18, frontline: 10, protection: 100 },
  Soraka: { engage: 15, frontline: 10, protection: 99 },
  Yuumi: { engage: 24, frontline: 5, protection: 97, early: 48 },
  Ivern: { engage: 58, frontline: 45, protection: 97, magicShare: 90 },
  Ashe: { engage: 90, protection: 52, magicShare: 8 },
  Jhin: { engage: 67, late: 83, scaling: 83 },
  Ezreal: { mid: 94, magicShare: 28 },
  Kaisa: { magicShare: 40, late: 96, scaling: 96 },
  Yone: { magicShare: 28, engage: 88, late: 94, scaling: 93 },
  Yasuo: { magicShare: 8, late: 91, scaling: 91, engage: 74 },
  Gwen: { magicShare: 90, late: 96, scaling: 97 },
  Mordekaiser: { magicShare: 95 },
  Rumble: { magicShare: 98, teamFight: 96 },
  Corki: { magicShare: 20 },
  Zed: { magicShare: 5 },
  Talon: { magicShare: 5 },
  Qiyana: { magicShare: 10, engage: 87 },
};

// Combat output, not the Support tag: mage supports and carry flex picks can
// still be damage dealers. These are editable simulation ratings, not live stats.
const outputOverrides: Record<string, [number, number, number]> = {
  Alistar: [32, 40, 25],
  Bard: [46, 37, 32],
  Blitzcrank: [42, 35, 28],
  Braum: [28, 25, 24],
  Ivern: [40, 65, 45],
  Janna: [26, 38, 20],
  Leona: [32, 30, 25],
  Lulu: [40, 48, 35],
  Milio: [22, 25, 18],
  Nami: [36, 32, 25],
  Nautilus: [42, 50, 30],
  Rakan: [32, 35, 22],
  Rell: [28, 35, 25],
  Renata: [30, 30, 24],
  Sona: [38, 28, 30],
  Soraka: [30, 35, 22],
  Taric: [36, 30, 32],
  Thresh: [42, 35, 30],
  Yuumi: [20, 18, 15],
  Zilean: [55, 75, 25],
  Pyke: [75, 40, 30],
  Senna: [82, 60, 75],
  Brand: [92, 88, 78],
  Zyra: [85, 88, 78],
  Karma: [65, 78, 42],
  Lux: [84, 88, 48],
  Seraphine: [76, 92, 55],
};

export const CHAMPIONS: Champion[] = RIOT_CHAMPIONS.map((raw) => {
  const has = (tag: string) => raw.tags.includes(tag);
  const marksman = has('Marksman'),
    mage = has('Mage'),
    tank = has('Tank'),
    support = has('Support'),
    assassin = has('Assassin');
  const roles = Object.values(Position).filter((p) =>
    recommended[p].has(raw.id),
  );
  if (!roles.length)
    roles.push(
      marksman
        ? Position.ADC
        : mage || assassin
          ? Position.MID
          : tank
            ? Position.TOP
            : support
              ? Position.SUPPORT
              : Position.TOP,
    );
  const defaultFits = marksman
    ? [66, 35, 73, 90, 36]
    : mage
      ? [62, 38, 90, 65, 68]
      : tank
        ? [88, 74, 55, 30, 80]
        : support
          ? [40, 30, 62, 36, 90]
          : assassin
            ? [68, 75, 88, 43, 33]
            : [87, 74, 66, 40, 42];
  const roleRatings = Object.fromEntries(
    Object.values(Position).map((p, i) => [
      p,
      roles.includes(p) ? 90 : defaultFits[i],
    ]),
  ) as Record<Position, number>;
  const curve: Curve = {
    early: clamp(62 + raw.info.attack * 2 - raw.info.difficulty),
    mid: clamp(77 + raw.info.magic * 0.7 + raw.info.attack * 0.3),
    late: clamp(
      (marksman ? 85 : mage ? 82 : tank ? 83 : support ? 81 : 72) +
        raw.info.magic * 0.5,
    ),
    lanePower: clamp(
      58 + raw.info.attack * 1.5 + raw.info.magic + (raw.range >= 500 ? 8 : 0),
    ),
    teamFight: clamp(
      (tank || mage || support ? 83 : 73) + raw.info.magic * 0.6,
    ),
    scaling: clamp(
      (marksman ? 88 : mage ? 85 : tank ? 83 : support ? 82 : 72) +
        raw.info.magic * 0.4,
    ),
    engage: tank ? 85 : assassin ? 75 : has('Fighter') ? 65 : support ? 55 : 35,
    frontline: clamp(
      tank
        ? 85 + raw.info.defense
        : has('Fighter')
          ? 55 + raw.info.defense * 2
          : 10 + raw.info.defense * 2,
    ),
    protection: support ? 84 : tank ? 53 : 22,
    magicShare: mage
      ? 90
      : support && !marksman
        ? 85
        : assassin && raw.info.magic > raw.info.attack
          ? 85
          : 12,
    ...overrides[raw.id],
  };
  const output = outputOverrides[raw.id] ?? [
    marksman
      ? 94
      : assassin
        ? 88
        : mage
          ? 86
          : has('Fighter')
            ? 82
            : tank
              ? 57
              : 45,
    mage
      ? 86
      : marksman
        ? 72
        : has('Fighter')
          ? 70
          : tank
            ? 62
            : assassin
              ? 60
              : 42,
    marksman
      ? 94
      : has('Fighter')
        ? 82
        : mage
          ? 62
          : assassin
            ? 55
            : tank
              ? 44
              : 30,
  ];
  return {
    ...curve,
    id: raw.id,
    championKey: raw.key,
    name: raw.name,
    title: raw.title,
    imageUrl: `https://ddragon.leagueoflegends.com/cdn/${RIOT_DATA_VERSION}/img/champion/${raw.image}`,
    tags: raw.tags,
    recommendedPositions: roles,
    roleRatings,
    difficulty: raw.info.difficulty,
    damage: output[0],
    waveClear: output[1],
    objectiveDamage: output[2],
    range: clamp((raw.range - 100) / 6),
    typeId: raw.tags[0],
    typeName: raw.tags.join(' / '),
    position: roles[0],
    variant: 'B' as const,
  };
});
export const CHAMPIONS_BY_ID = new Map(CHAMPIONS.map((c) => [c.id, c]));
export const CHAMPION_BALANCE_VERSION = 'prototype-2';
