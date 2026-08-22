import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CareersService } from '../../careers/careers.service';
import { CreateCareerDto } from '../../careers/dto/create-career.dto';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { Career } from '../../careers/entities/career.entity';
import { Region } from '../../careers/enums/region.enum';
import { PlayerCard } from '../../players/entities/player-card.entity';
import { Player } from '../../players/entities/player.entity';
import { Theme } from '../../players/entities/theme.entity';
import { Position } from '../../players/enums/position.enum';
import dataSource from '../data-source';

interface DevelopmentSeedData {
  startYear: number;
  managedTeamCode: string;
  themes: Array<{
    code: string;
    name: string;
    description: string | null;
  }>;
  playerCards: DevelopmentPlayerCardData[];
  teams: Array<{
    code: string;
    name: string;
    region: Region;
    starters: Array<{
      position: Position;
      playerCardKey: string;
    }>;
  }>;
}

interface DevelopmentPlayerCardData {
  key: string;
  nickname: string;
  nationality: string;
  themeCode: string;
  cardYear: number;
  startingAge: number;
  mainPosition: Position;
  imageUrl: string;
  mechanics: number;
  gameSense: number;
  laning: number;
  teamFight: number;
  macro: number;
  teamPlay: number;
  mental: number;
  championPool: number;
  potential: number;
}

async function loadSeedData(): Promise<DevelopmentSeedData> {
  const seedFilePath = resolve(process.cwd(), 'data', 'development-seed.json');
  const contents = await readFile(seedFilePath, 'utf8');
  const parsed = JSON.parse(contents) as unknown;

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('playerCards' in parsed) ||
    !Array.isArray(parsed.playerCards) ||
    !('teams' in parsed) ||
    !Array.isArray(parsed.teams)
  ) {
    throw new Error('development-seed.json has an invalid structure');
  }

  return parsed as DevelopmentSeedData;
}

async function seedCatalog(
  seedData: DevelopmentSeedData,
): Promise<Map<string, PlayerCard>> {
  return dataSource.transaction(async (manager) => {
    const themesRepository = manager.getRepository(Theme);
    const playersRepository = manager.getRepository(Player);
    const playerCardsRepository = manager.getRepository(PlayerCard);
    const themesByCode = new Map<string, Theme>();

    for (const themeData of seedData.themes) {
      const theme =
        (await themesRepository.findOneBy({ code: themeData.code })) ??
        themesRepository.create({ code: themeData.code });

      theme.name = themeData.name;
      theme.description = themeData.description;
      themesByCode.set(themeData.code, await themesRepository.save(theme));
    }

    const playerCardsByKey = new Map<string, PlayerCard>();

    for (const cardData of seedData.playerCards) {
      const theme = themesByCode.get(cardData.themeCode);

      if (!theme) {
        throw new Error(`Unknown theme code: ${cardData.themeCode}`);
      }

      const player =
        (await playersRepository.findOneBy({
          nickname: cardData.nickname,
          nationality: cardData.nationality,
        })) ??
        (await playersRepository.save(
          playersRepository.create({
            nickname: cardData.nickname,
            nationality: cardData.nationality,
          }),
        ));
      const playerCard =
        (await playerCardsRepository.findOneBy({
          playerId: player.id,
          themeId: theme.id,
          cardYear: cardData.cardYear,
        })) ??
        playerCardsRepository.create({
          playerId: player.id,
          player,
          themeId: theme.id,
          theme,
          cardYear: cardData.cardYear,
        });

      Object.assign(playerCard, {
        startingAge: cardData.startingAge,
        imageUrl: cardData.imageUrl,
        mainPosition: cardData.mainPosition,
        mechanics: cardData.mechanics,
        gameSense: cardData.gameSense,
        laning: cardData.laning,
        teamFight: cardData.teamFight,
        macro: cardData.macro,
        teamPlay: cardData.teamPlay,
        mental: cardData.mental,
        championPool: cardData.championPool,
        potential: cardData.potential,
      });
      playerCardsByKey.set(
        cardData.key,
        await playerCardsRepository.save(playerCard),
      );
    }

    return playerCardsByKey;
  });
}

async function seedCareer(
  seedData: DevelopmentSeedData,
  playerCardsByKey: Map<string, PlayerCard>,
): Promise<number> {
  const careerTeamsRepository = dataSource.getRepository(CareerTeam);
  const existingSeedTeam = await careerTeamsRepository.findOne({
    where: { code: seedData.managedTeamCode },
    relations: { career: true },
  });

  if (existingSeedTeam) {
    return existingSeedTeam.career.id;
  }

  const dto: CreateCareerDto = {
    startYear: seedData.startYear,
    managedTeamCode: seedData.managedTeamCode,
    teams: seedData.teams.map((team) => ({
      code: team.code,
      name: team.name,
      region: team.region,
      starters: team.starters.map((starter) => {
        const playerCard = playerCardsByKey.get(starter.playerCardKey);

        if (!playerCard) {
          throw new Error(`Unknown PlayerCard key: ${starter.playerCardKey}`);
        }

        return {
          playerCardId: playerCard.id,
          position: starter.position,
        };
      }),
    })),
  };
  const careersService = new CareersService(
    dataSource,
    dataSource.getRepository(Career),
  );
  const career = await careersService.create(dto);

  return career.id;
}

async function runSeed(): Promise<void> {
  const seedData = await loadSeedData();

  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
    const playerCardsByKey = await seedCatalog(seedData);
    const careerId = await seedCareer(seedData, playerCardsByKey);

    console.log(
      `Development seed ready: ${playerCardsByKey.size} PlayerCards, Career ${careerId}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void runSeed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Development seed failed: ${message}`);
  process.exitCode = 1;
});
