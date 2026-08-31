import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PasswordService } from '../../auth/password.service';
import { Account } from '../../auth/entities/account.entity';
import { CareersService } from '../../careers/careers.service';
import { isChampionArchetypeAllowed } from '../../careers/config/champion-archetype.config';
import {
  PLAYER_INSTRUCTIONS_BY_POSITION,
  ROLE_PROFICIENCY_CONFIG,
} from '../../careers/config/player-instruction.config';
import { CAREER_PLAYER_STATE_CONFIG } from '../../careers/config/player-state.config';
import { POSITION_PROFICIENCY_CONFIG } from '../../careers/config/position-proficiency.config';
import { TEAM_CHEMISTRY_CONFIG } from '../../careers/config/team-chemistry.config';
import { TEAM_STRATEGY_PROFICIENCY_CONFIG } from '../../careers/config/team-strategy-proficiency.config';
import { STARTER_POSITIONS } from '../../careers/constants/career.constants';
import { CreateCareerDto } from '../../careers/dto/create-career.dto';
import { CareerTeam } from '../../careers/entities/career-team.entity';
import { CareerTeamStrategyProficiency } from '../../careers/entities/career-team-strategy-proficiency.entity';
import { CareerPlayer } from '../../careers/entities/career-player.entity';
import { CareerPlayerPositionProficiency } from '../../careers/entities/career-player-position-proficiency.entity';
import { CareerPlayerRoleProficiency } from '../../careers/entities/career-player-role-proficiency.entity';
import { Career } from '../../careers/entities/career.entity';
import { Roster } from '../../careers/entities/roster.entity';
import { ChampionArchetype } from '../../careers/enums/champion-archetype.enum';
import { Region } from '../../careers/enums/region.enum';
import { RosterRole } from '../../careers/enums/roster-role.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import { PlayerCard } from '../../players/entities/player-card.entity';
import { Player } from '../../players/entities/player.entity';
import { Theme } from '../../players/entities/theme.entity';
import { Position } from '../../players/enums/position.enum';
import { PlayerPersonality } from '../../players/enums/player-personality.enum';
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
    initialChemistry?: number;
    starters: Array<{
      position: Position;
      playerCardKey: string;
      championArchetype?: ChampionArchetype;
      initialCoachTrust?: number;
    }>;
    benches?: Array<{
      playerCardKey: string;
      initialForm: number;
    }>;
  }>;
}

interface DevelopmentPlayerCardData {
  key: string;
  nickname: string;
  nationality?: string;
  themeCode: string;
  cardYear: number;
  startingAge?: number;
  mainPosition: Position;
  imageUrl?: string;
  mechanics: number;
  gameSense: number;
  laning: number;
  teamFight: number;
  macro: number;
  teamPlay: number;
  mental: number;
  championPool: number;
  personality?: PlayerPersonality;
  potential?: number;
}

const DEVELOPMENT_PLAYER_DEFAULTS = {
  nationality: 'UNKNOWN',
  startingAge: 20,
  personality: PlayerPersonality.PROFESSIONAL,
} as const;

function getFallbackPotential(cardData: DevelopmentPlayerCardData): number {
  return Math.max(
    cardData.mechanics,
    cardData.gameSense,
    cardData.laning,
    cardData.teamFight,
    cardData.macro,
    cardData.teamPlay,
    cardData.mental,
    cardData.championPool,
  );
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
      const nationality =
        cardData.nationality ?? DEVELOPMENT_PLAYER_DEFAULTS.nationality;

      if (!theme) {
        throw new Error(`Unknown theme code: ${cardData.themeCode}`);
      }

      let player = await playersRepository.findOneBy({
        nickname: cardData.nickname,
        nationality,
      });

      if (!player && nationality !== DEVELOPMENT_PLAYER_DEFAULTS.nationality) {
        const unknownPlayers = await playersRepository.findBy({
          nickname: cardData.nickname,
          nationality: DEVELOPMENT_PLAYER_DEFAULTS.nationality,
        });

        if (unknownPlayers.length > 1) {
          throw new Error(
            `Multiple UNKNOWN players found for ${cardData.nickname}; nationality cannot be migrated safely`,
          );
        }

        if (unknownPlayers.length === 1) {
          unknownPlayers[0].nationality = nationality;
          player = await playersRepository.save(unknownPlayers[0]);
        }
      }

      player ??= await playersRepository.save(
        playersRepository.create({
          nickname: cardData.nickname,
          nationality,
        }),
      );
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
        startingAge:
          cardData.startingAge ?? DEVELOPMENT_PLAYER_DEFAULTS.startingAge,
        imageUrl: cardData.imageUrl ?? null,
        mainPosition: cardData.mainPosition,
        mechanics: cardData.mechanics,
        gameSense: cardData.gameSense,
        laning: cardData.laning,
        teamFight: cardData.teamFight,
        macro: cardData.macro,
        teamPlay: cardData.teamPlay,
        mental: cardData.mental,
        championPool: cardData.championPool,
        personality:
          cardData.personality ?? DEVELOPMENT_PLAYER_DEFAULTS.personality,
        potential: cardData.potential ?? getFallbackPotential(cardData),
      });
      playerCardsByKey.set(
        cardData.key,
        await playerCardsRepository.save(playerCard),
      );
    }

    return playerCardsByKey;
  });
}

interface ExistingCareerSyncResult {
  createdTeamCount: number;
  createdStarterCount: number;
}

async function syncExistingCareerTeamsAndStarters(
  careerId: number,
  seedData: DevelopmentSeedData,
  playerCardsByKey: Map<string, PlayerCard>,
): Promise<ExistingCareerSyncResult> {
  return dataSource.transaction(async (manager) => {
    let createdTeamCount = 0;
    let createdStarterCount = 0;

    for (const teamData of seedData.teams) {
      let careerTeam = await manager.findOneBy(CareerTeam, {
        careerId,
        code: teamData.code,
      });

      if (!careerTeam) {
        careerTeam = await manager.save(
          CareerTeam,
          manager.create(CareerTeam, {
            careerId,
            code: teamData.code,
            name: teamData.name,
            region: teamData.region,
            isUserControlled: teamData.code === seedData.managedTeamCode,
            teamStrategy: TeamStrategy.BALANCED,
            chemistry:
              teamData.initialChemistry ?? TEAM_CHEMISTRY_CONFIG.initial,
          }),
        );
        createdTeamCount += 1;
      } else {
        careerTeam.name = teamData.name;
        careerTeam.region = teamData.region;
        careerTeam.isUserControlled =
          teamData.code === seedData.managedTeamCode;
        careerTeam = await manager.save(CareerTeam, careerTeam);
      }

      for (const strategy of Object.values(TeamStrategy)) {
        const existingProficiency = await manager.findOneBy(
          CareerTeamStrategyProficiency,
          { careerTeamId: careerTeam.id, strategy },
        );

        if (!existingProficiency) {
          await manager.save(
            CareerTeamStrategyProficiency,
            manager.create(CareerTeamStrategyProficiency, {
              careerTeamId: careerTeam.id,
              careerTeam,
              strategy,
              proficiency: TEAM_STRATEGY_PROFICIENCY_CONFIG.initial,
            }),
          );
        }
      }

      for (const starterData of teamData.starters) {
        const playerCard = playerCardsByKey.get(starterData.playerCardKey);

        if (!playerCard) {
          throw new Error(
            `Unknown PlayerCard key: ${starterData.playerCardKey}`,
          );
        }

        const existingStarter = await manager.findOne(Roster, {
          where: {
            careerTeamId: careerTeam.id,
            role: RosterRole.STARTER,
            starterPosition: starterData.position,
          },
          relations: { careerPlayer: true },
        });

        if (existingStarter) {
          if (existingStarter.careerPlayer.playerCardId !== playerCard.id) {
            throw new Error(
              `${teamData.code} ${starterData.position} is already occupied by another player; the seed will not overwrite an existing save`,
            );
          }

          continue;
        }

        let careerPlayer = await manager.findOne(CareerPlayer, {
          where: { careerId, playerCardId: playerCard.id },
          relations: { roster: true },
        });

        if (careerPlayer?.roster) {
          throw new Error(
            `${starterData.playerCardKey} is already registered in another roster`,
          );
        }

        if (!careerPlayer) {
          careerPlayer = await manager.save(
            CareerPlayer,
            manager.create(CareerPlayer, {
              careerId,
              playerCardId: playerCard.id,
              playerCard,
              currentTeamId: careerTeam.id,
              currentTeam: careerTeam,
              currentAge: playerCard.startingAge,
              currentPosition: starterData.position,
              currentMechanics: playerCard.mechanics,
              currentGameSense: playerCard.gameSense,
              currentLaning: playerCard.laning,
              currentTeamFight: playerCard.teamFight,
              currentMacro: playerCard.macro,
              currentTeamPlay: playerCard.teamPlay,
              currentMental: playerCard.mental,
              currentChampionPool: playerCard.championPool,
              form: CAREER_PLAYER_STATE_CONFIG.initial.form,
              condition: CAREER_PLAYER_STATE_CONFIG.initial.condition,
              personality: playerCard.personality,
              coachTrust:
                starterData.initialCoachTrust ??
                CAREER_PLAYER_STATE_CONFIG.initial.coachTrust,
            }),
          );

          await manager.save(
            CareerPlayerPositionProficiency,
            STARTER_POSITIONS.map((position) =>
              manager.create(CareerPlayerPositionProficiency, {
                careerPlayerId: careerPlayer!.id,
                careerPlayer: careerPlayer!,
                position,
                proficiency:
                  position === starterData.position
                    ? POSITION_PROFICIENCY_CONFIG.initialPrimary
                    : POSITION_PROFICIENCY_CONFIG.initialSecondary,
              }),
            ),
          );
          await manager.save(
            CareerPlayerRoleProficiency,
            PLAYER_INSTRUCTIONS_BY_POSITION[starterData.position].map(
              (instruction) =>
                manager.create(CareerPlayerRoleProficiency, {
                  careerPlayerId: careerPlayer!.id,
                  careerPlayer: careerPlayer!,
                  position: starterData.position,
                  instruction,
                  proficiency: ROLE_PROFICIENCY_CONFIG.initial,
                }),
            ),
          );
        } else {
          careerPlayer.currentTeamId = careerTeam.id;
          careerPlayer.currentTeam = careerTeam;
          careerPlayer.currentPosition = starterData.position;
          careerPlayer = await manager.save(CareerPlayer, careerPlayer);
        }

        await manager.save(
          Roster,
          manager.create(Roster, {
            careerTeamId: careerTeam.id,
            careerTeam,
            careerPlayerId: careerPlayer.id,
            careerPlayer,
            role: RosterRole.STARTER,
            starterPosition: starterData.position,
            playerInstruction: null,
            championArchetype: null,
          }),
        );
        createdStarterCount += 1;
      }
    }

    return { createdTeamCount, createdStarterCount };
  });
}

async function initializeNewCareerSeedValues(
  careerId: number,
  seedData: DevelopmentSeedData,
  playerCardsByKey: Map<string, PlayerCard>,
): Promise<void> {
  await dataSource.transaction(async (manager) => {
    for (const teamData of seedData.teams) {
      const careerTeam = await manager.findOneBy(CareerTeam, {
        careerId,
        code: teamData.code,
      });

      if (!careerTeam) {
        throw new Error(`CareerTeam ${teamData.code} was not found`);
      }

      if (teamData.initialChemistry !== undefined) {
        careerTeam.chemistry = teamData.initialChemistry;
        await manager.save(CareerTeam, careerTeam);
      }

      for (const starterData of teamData.starters) {
        if (starterData.initialCoachTrust === undefined) {
          continue;
        }

        const playerCard = playerCardsByKey.get(starterData.playerCardKey);

        if (!playerCard) {
          throw new Error(
            `Unknown PlayerCard key: ${starterData.playerCardKey}`,
          );
        }

        const careerPlayer = await manager.findOneBy(CareerPlayer, {
          careerId,
          playerCardId: playerCard.id,
        });

        if (!careerPlayer) {
          throw new Error(
            `CareerPlayer ${starterData.playerCardKey} was not found`,
          );
        }

        careerPlayer.coachTrust = starterData.initialCoachTrust;
        await manager.save(CareerPlayer, careerPlayer);
      }
    }
  });
}

async function seedCareer(
  accountId: number,
  seedData: DevelopmentSeedData,
  playerCardsByKey: Map<string, PlayerCard>,
): Promise<{
  careerId: number;
  created: boolean;
  createdTeamCount: number;
  createdStarterCount: number;
}> {
  const careerTeamsRepository = dataSource.getRepository(CareerTeam);
  const existingSeedTeam = await careerTeamsRepository
    .createQueryBuilder('careerTeam')
    .innerJoinAndSelect('careerTeam.career', 'career')
    .where('careerTeam.code = :code', { code: seedData.managedTeamCode })
    .andWhere('career.accountId = :accountId', { accountId })
    .getOne();

  if (existingSeedTeam) {
    const syncResult = await syncExistingCareerTeamsAndStarters(
      existingSeedTeam.career.id,
      seedData,
      playerCardsByKey,
    );

    return {
      careerId: existingSeedTeam.career.id,
      created: false,
      ...syncResult,
    };
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
      benches: (team.benches ?? []).map((bench) => {
        const playerCard = playerCardsByKey.get(bench.playerCardKey);

        if (!playerCard) {
          throw new Error(`Unknown PlayerCard key: ${bench.playerCardKey}`);
        }

        return { playerCardId: playerCard.id };
      }),
    })),
  };
  const careersService = new CareersService(
    dataSource,
    dataSource.getRepository(Career),
    dataSource.getRepository(SetBonus),
  );
  const career = await careersService.create(accountId, dto);
  await initializeNewCareerSeedValues(career.id, seedData, playerCardsByKey);

  return {
    careerId: career.id,
    created: true,
    createdTeamCount: seedData.teams.length,
    createdStarterCount: seedData.teams.reduce(
      (count, team) => count + team.starters.length,
      0,
    ),
  };
}

async function syncCareerBenches(
  careerId: number,
  initializeExistingBenches: boolean,
  seedData: DevelopmentSeedData,
  playerCardsByKey: Map<string, PlayerCard>,
): Promise<number> {
  return dataSource.transaction(async (manager) => {
    let createdCount = 0;

    for (const teamData of seedData.teams) {
      const careerTeam = await manager.findOneBy(CareerTeam, {
        careerId,
        code: teamData.code,
      });

      if (!careerTeam) {
        throw new Error(`CareerTeam ${teamData.code} was not found`);
      }

      for (const benchData of teamData.benches ?? []) {
        if (
          benchData.initialForm < CAREER_PLAYER_STATE_CONFIG.min ||
          benchData.initialForm > CAREER_PLAYER_STATE_CONFIG.max
        ) {
          throw new Error(
            `${benchData.playerCardKey} initialForm must be between ${CAREER_PLAYER_STATE_CONFIG.min} and ${CAREER_PLAYER_STATE_CONFIG.max}`,
          );
        }

        const playerCard = playerCardsByKey.get(benchData.playerCardKey);

        if (!playerCard) {
          throw new Error(`Unknown PlayerCard key: ${benchData.playerCardKey}`);
        }

        let careerPlayer = await manager.findOne(CareerPlayer, {
          where: { careerId, playerCardId: playerCard.id },
          relations: { roster: true },
        });

        if (careerPlayer?.roster) {
          if (careerPlayer.roster.careerTeamId !== careerTeam.id) {
            throw new Error(
              `${benchData.playerCardKey} is already registered outside ${teamData.code}`,
            );
          }

          if (
            initializeExistingBenches &&
            careerPlayer.roster.role === RosterRole.BENCH
          ) {
            careerPlayer.form = benchData.initialForm;
            await manager.save(CareerPlayer, careerPlayer);
          }

          continue;
        }

        if (!careerPlayer) {
          careerPlayer = await manager.save(
            CareerPlayer,
            manager.create(CareerPlayer, {
              careerId,
              playerCardId: playerCard.id,
              playerCard,
              currentTeamId: careerTeam.id,
              currentTeam: careerTeam,
              currentAge: playerCard.startingAge,
              currentPosition: playerCard.mainPosition,
              currentMechanics: playerCard.mechanics,
              currentGameSense: playerCard.gameSense,
              currentLaning: playerCard.laning,
              currentTeamFight: playerCard.teamFight,
              currentMacro: playerCard.macro,
              currentTeamPlay: playerCard.teamPlay,
              currentMental: playerCard.mental,
              currentChampionPool: playerCard.championPool,
              form: benchData.initialForm,
              condition: CAREER_PLAYER_STATE_CONFIG.initial.condition,
              personality: playerCard.personality,
              coachTrust: CAREER_PLAYER_STATE_CONFIG.initial.coachTrust,
            }),
          );

          await manager.save(
            CareerPlayerPositionProficiency,
            STARTER_POSITIONS.map((position) =>
              manager.create(CareerPlayerPositionProficiency, {
                careerPlayerId: careerPlayer!.id,
                careerPlayer: careerPlayer!,
                position,
                proficiency:
                  position === playerCard.mainPosition
                    ? POSITION_PROFICIENCY_CONFIG.initialPrimary
                    : POSITION_PROFICIENCY_CONFIG.initialSecondary,
              }),
            ),
          );
          await manager.save(
            CareerPlayerRoleProficiency,
            PLAYER_INSTRUCTIONS_BY_POSITION[playerCard.mainPosition].map(
              (instruction) =>
                manager.create(CareerPlayerRoleProficiency, {
                  careerPlayerId: careerPlayer!.id,
                  careerPlayer: careerPlayer!,
                  position: playerCard.mainPosition,
                  instruction,
                  proficiency: ROLE_PROFICIENCY_CONFIG.initial,
                }),
            ),
          );
        } else {
          careerPlayer.currentTeamId = careerTeam.id;
          careerPlayer.currentTeam = careerTeam;
          careerPlayer.form = benchData.initialForm;
          careerPlayer = await manager.save(CareerPlayer, careerPlayer);
        }

        await manager.save(
          Roster,
          manager.create(Roster, {
            careerTeamId: careerTeam.id,
            careerTeam,
            careerPlayerId: careerPlayer.id,
            careerPlayer,
            role: RosterRole.BENCH,
            starterPosition: null,
            playerInstruction: null,
            championArchetype: null,
          }),
        );
        createdCount += 1;
      }
    }

    return createdCount;
  });
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

async function syncCareerPlayerPersonalities(careerId: number): Promise<void> {
  const careerPlayersRepository = dataSource.getRepository(CareerPlayer);
  const careerPlayers = await careerPlayersRepository.find({
    where: { careerId },
    relations: { playerCard: true },
  });

  await careerPlayersRepository.save(
    careerPlayers.map((careerPlayer) => {
      careerPlayer.personality = careerPlayer.playerCard.personality;
      return careerPlayer;
    }),
  );
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
    const seededCareer = await seedCareer(
      account.id,
      seedData,
      playerCardsByKey,
    );
    const benchCount = await syncCareerBenches(
      seededCareer.careerId,
      seededCareer.created,
      seedData,
      playerCardsByKey,
    );
    const careerId = seededCareer.careerId;
    await syncCareerPlayerPersonalities(careerId);
    const archetypeCount = await seedChampionArchetypes(careerId, seedData);

    console.log(
      `Development seed ready: Account ${account.email}, ${playerCardsByKey.size} PlayerCards, ${setBonusCount} SetBonuses, ${seededCareer.createdTeamCount} new Teams, ${seededCareer.createdStarterCount} new Starter slots, ${archetypeCount} ChampionArchetypes, ${benchCount} new Bench slots, Career ${careerId}`,
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
