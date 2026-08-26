import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PasswordService } from '../../auth/password.service';
import { Account } from '../../auth/entities/account.entity';
import { CareersService } from '../../careers/careers.service';
import { isChampionArchetypeAllowed } from '../../careers/config/champion-archetype.config';
import { CreateCareerDto } from '../../careers/dto/create-career.dto';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { Career } from '../../careers/entities/career.entity';
import { Roster } from '../../careers/entities/roster.entity';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { Region } from '../../careers/enums/region.enum';
import { RosterRole } from '../../careers/enums/roster-role.enum';
import { PlayerCard } from '../../players/entities/player-card.entity';
import { Player } from '../../players/entities/player.entity';
import { Theme } from '../../players/entities/theme.entity';
import { Position } from '../../players/enums/position.enum';
import { SetBonus } from '../../set-bonuses/entities/set-bonus.entity';
import { SetBonusRequirement } from '../../set-bonuses/entities/set-bonus-requirement.entity';
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
  setBonuses: Array<{
    code: string;
    name: string;
    description: string | null;
    requiredPlayerCardKeys: string[];
    chemistryBonus: number;
    laningBonus: number;
    teamFightBonus: number;
    macroBonus: number;
    teamPlayBonus: number;
  }>;
  teams: Array<{
    code: string;
    name: string;
    region: Region;
    starters: Array<{
      position: Position;
      playerCardKey: string;
      championArchetype?: ChampionArchetype;
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

interface DevelopmentAccountConfig {
  email: string;
  password: string;
  displayName: string;
}

function loadDevelopmentAccountConfig(): DevelopmentAccountConfig {
  const email = process.env.DEV_ACCOUNT_EMAIL;
  const password = process.env.DEV_ACCOUNT_PASSWORD;
  const displayName = process.env.DEV_ACCOUNT_DISPLAY_NAME;

  if (!email || !password || !displayName) {
    throw new Error(
      'DEV_ACCOUNT_EMAIL, DEV_ACCOUNT_PASSWORD, and DEV_ACCOUNT_DISPLAY_NAME are required for the development seed',
    );
  }

  return {
    email: email.trim().toLowerCase(),
    password,
    displayName: displayName.trim(),
  };
}

async function seedDevelopmentAccount(
  accountConfig: DevelopmentAccountConfig,
): Promise<Account> {
  const accountsRepository = dataSource.getRepository(Account);
  const careersRepository = dataSource.getRepository(Career);
  const passwordService = new PasswordService();
  const account =
    (await accountsRepository.findOneBy({ email: accountConfig.email })) ??
    accountsRepository.create({ email: accountConfig.email });

  account.displayName = accountConfig.displayName;
  account.passwordHash = await passwordService.hash(accountConfig.password);
  const savedAccount = await accountsRepository.save(account);
  const legacyAccount = await accountsRepository.findOneBy({
    email: 'legacy-save@local.invalid',
  });

  if (legacyAccount && legacyAccount.id !== savedAccount.id) {
    await careersRepository.update(
      { accountId: legacyAccount.id },
      { accountId: savedAccount.id },
    );
  }

  return savedAccount;
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
  accountId: number,
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
    dataSource.getRepository(SetBonus),
  );
  const career = await careersService.create(accountId, dto);

  return career.id;
}

async function seedSetBonuses(
  seedData: DevelopmentSeedData,
  playerCardsByKey: Map<string, PlayerCard>,
): Promise<number> {
  return dataSource.transaction(async (manager) => {
    const setBonusesRepository = manager.getRepository(SetBonus);
    const requirementsRepository = manager.getRepository(SetBonusRequirement);

    for (const setBonusData of seedData.setBonuses) {
      const requiredPlayerCards = setBonusData.requiredPlayerCardKeys.map(
        (playerCardKey) => {
          const playerCard = playerCardsByKey.get(playerCardKey);

          if (!playerCard) {
            throw new Error(`Unknown PlayerCard key: ${playerCardKey}`);
          }

          return playerCard;
        },
      );
      const setBonus =
        (await setBonusesRepository.findOneBy({ code: setBonusData.code })) ??
        setBonusesRepository.create({ code: setBonusData.code });

      Object.assign(setBonus, {
        name: setBonusData.name,
        description: setBonusData.description,
        chemistryBonus: setBonusData.chemistryBonus,
        laningBonus: setBonusData.laningBonus,
        teamFightBonus: setBonusData.teamFightBonus,
        macroBonus: setBonusData.macroBonus,
        teamPlayBonus: setBonusData.teamPlayBonus,
      });
      const savedSetBonus = await setBonusesRepository.save(setBonus);

      await requirementsRepository.delete({ setBonusId: savedSetBonus.id });
      await requirementsRepository.save(
        requiredPlayerCards.map((playerCard) =>
          requirementsRepository.create({
            setBonusId: savedSetBonus.id,
            setBonus: savedSetBonus,
            playerCardId: playerCard.id,
            playerCard,
          }),
        ),
      );
    }

    return seedData.setBonuses.length;
  });
}

async function seedChampionArchetypes(
  careerId: number,
  seedData: DevelopmentSeedData,
): Promise<number> {
  return dataSource.transaction(async (manager) => {
    const careerTeamsRepository = manager.getRepository(CareerTeam);
    const rostersRepository = manager.getRepository(Roster);
    let updatedCount = 0;

    for (const teamData of seedData.teams) {
      const careerTeam = await careerTeamsRepository.findOneBy({
        careerId,
        code: teamData.code,
      });

      if (!careerTeam) {
        throw new Error(`CareerTeam ${teamData.code} was not found`);
      }

      for (const starter of teamData.starters) {
        if (starter.championArchetype === undefined) {
          continue;
        }

        if (
          !isChampionArchetypeAllowed(
            starter.position,
            starter.championArchetype,
          )
        ) {
          throw new Error(
            `${starter.championArchetype} is not valid for ${starter.position}`,
          );
        }

        const updateResult = await rostersRepository.update(
          {
            careerTeamId: careerTeam.id,
            role: RosterRole.STARTER,
            starterPosition: starter.position,
          },
          { championArchetype: starter.championArchetype },
        );

        if (updateResult.affected !== 1) {
          throw new Error(
            `${teamData.code} ${starter.position} starter was not found`,
          );
        }

        updatedCount += 1;
      }
    }

    return updatedCount;
  });
}

async function runSeed(): Promise<void> {
  const seedData = await loadSeedData();
  const accountConfig = loadDevelopmentAccountConfig();

  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
    const account = await seedDevelopmentAccount(accountConfig);
    const playerCardsByKey = await seedCatalog(seedData);
    const setBonusCount = await seedSetBonuses(seedData, playerCardsByKey);
    const careerId = await seedCareer(account.id, seedData, playerCardsByKey);
    const archetypeCount = await seedChampionArchetypes(careerId, seedData);

    console.log(
      `Development seed ready: Account ${account.email}, ${playerCardsByKey.size} PlayerCards, ${setBonusCount} SetBonuses, ${archetypeCount} ChampionArchetypes, Career ${careerId}`,
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
