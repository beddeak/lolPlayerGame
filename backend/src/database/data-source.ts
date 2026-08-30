import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { DataSource } from 'typeorm';
import { Account } from '../auth/entities/account.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerPlayerPositionProficiency } from '../careers/entities/career-player-position-proficiency.entity';
import { CareerPlayerRoleProficiency } from '../careers/entities/career-player-role-proficiency.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { CareerTeamStrategyProficiency } from '../careers/entities/career-team-strategy-proficiency.entity';
import { Career } from '../careers/entities/career.entity';
import { Roster } from '../careers/entities/roster.entity';
import { TrainingPeriod } from '../careers/entities/training-period.entity';
import { TrainingSession } from '../careers/entities/training-session.entity';
import { validateEnvironment } from '../config/environment.validation';
import { MatchPlayerStat } from '../matches/entities/match-player-stat.entity';
import { Match } from '../matches/entities/match.entity';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { MatchFeedback } from '../match-series/entities/match-feedback.entity';
import { MatchFeedbackPlayerEffect } from '../match-series/entities/match-feedback-player-effect.entity';
import { LeagueFixture } from '../leagues/entities/league-fixture.entity';
import { LeagueSplit } from '../leagues/entities/league-split.entity';
import { LeagueStageParticipant } from '../leagues/entities/league-stage-participant.entity';
import { LeagueStage } from '../leagues/entities/league-stage.entity';
import { PlayerCard } from '../players/entities/player-card.entity';
import { Player } from '../players/entities/player.entity';
import { Theme } from '../players/entities/theme.entity';
import { SetBonusRequirement } from '../set-bonuses/entities/set-bonus-requirement.entity';
import { SetBonus } from '../set-bonuses/entities/set-bonus.entity';
import { CreateCareerDomain1787410800000 } from './migrations/1787410800000-create-career-domain';
import { AddPlayerCardImageUrl1787414400000 } from './migrations/1787414400000-add-player-card-image-url';
import { CreateMatchStats1787418000000 } from './migrations/1787418000000-create-match-stats';
import { AddTeamStrategy1787421600000 } from './migrations/1787421600000-add-team-strategy';
import { AddPlayerInstructionRoleProficiency1787425200000 } from './migrations/1787425200000-add-player-instruction-role-proficiency';
import { AddMetaStrategyProficiency1787428800000 } from './migrations/1787428800000-add-meta-strategy-proficiency';
import { AddAccountAuth1787515200000 } from './migrations/1787515200000-add-account-auth';
import { FixRosterOneToOneIndex1787601600000 } from './migrations/1787601600000-fix-roster-one-to-one-index';
import { AddTeamChemistrySetBonuses1787605200000 } from './migrations/1787605200000-add-team-chemistry-set-bonuses';
import { AddChampionArchetypes1787608800000 } from './migrations/1787608800000-add-champion-archetypes';
import { ExpandChampionArchetypes1787695200000 } from './migrations/1787695200000-expand-champion-archetypes';
import { CreateBo3MatchSeries1787781600000 } from './migrations/1787781600000-create-bo3-match-series';
import { AddPlayerMatchState1787868000000 } from './migrations/1787868000000-add-player-match-state';
import { AddMatchFeedback1787954400000 } from './migrations/1787954400000-add-match-feedback';
import { AddTraining1788040800000 } from './migrations/1788040800000-add-training';
import { CreateLeague1788127200000 } from './migrations/1788127200000-create-league';
import { AddRegionalLeagueStages1788213600000 } from './migrations/1788213600000-add-regional-league-stages';
import { CreatePlayerCatalog1787237754573 } from './migrations/1787237754573-create-player-catalog';

if (existsSync('.env')) {
  loadEnvFile('.env');
}

const environment = validateEnvironment(process.env);
const useSsl = environment.DB_SSL === 'true';

const dataSource = new DataSource({
  type: 'mysql',
  host: environment.DB_HOST,
  port: environment.DB_PORT,
  username: environment.DB_USERNAME,
  password: environment.DB_PASSWORD,
  database: environment.DB_DATABASE,
  entities: [
    Account,
    Player,
    Theme,
    PlayerCard,
    SetBonus,
    SetBonusRequirement,
    Career,
    CareerTeam,
    CareerTeamStrategyProficiency,
    CareerPlayer,
    CareerPlayerPositionProficiency,
    CareerPlayerRoleProficiency,
    Roster,
    TrainingPeriod,
    TrainingSession,
    Match,
    MatchPlayerStat,
    MatchSeries,
    MatchFeedback,
    MatchFeedbackPlayerEffect,
    LeagueSplit,
    LeagueStage,
    LeagueStageParticipant,
    LeagueFixture,
  ],
  migrations: [
    CreatePlayerCatalog1787237754573,
    CreateCareerDomain1787410800000,
    AddPlayerCardImageUrl1787414400000,
    CreateMatchStats1787418000000,
    AddTeamStrategy1787421600000,
    AddPlayerInstructionRoleProficiency1787425200000,
    AddMetaStrategyProficiency1787428800000,
    AddAccountAuth1787515200000,
    FixRosterOneToOneIndex1787601600000,
    AddTeamChemistrySetBonuses1787605200000,
    AddChampionArchetypes1787608800000,
    ExpandChampionArchetypes1787695200000,
    CreateBo3MatchSeries1787781600000,
    AddPlayerMatchState1787868000000,
    AddMatchFeedback1787954400000,
    AddTraining1788040800000,
    CreateLeague1788127200000,
    AddRegionalLeagueStages1788213600000,
  ],
  migrationsTableName: 'migrations',
  ssl: useSsl ? { rejectUnauthorized: true } : undefined,
  synchronize: false,
});

export default dataSource;
