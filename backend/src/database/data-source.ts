import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { DataSource } from 'typeorm';
import { Account } from '../auth/entities/account.entity';
import { SocialIdentity } from '../auth/entities/social-identity.entity';
import { GoogleAuthChallenge } from '../auth/entities/google-auth-challenge.entity';
import { AddGoogleAuth1789077600000 } from './migrations/1789077600000-add-google-auth';
import { WeeklyTraining1789164000000 } from './migrations/1789164000000-weekly-training';
import { InternationalTournaments1789250400000 } from './migrations/1789250400000-international-tournaments';
import { AddLcpCblol1789336800000 } from './migrations/1789336800000-add-lcp-cblol';
import { TeamActivityEffects1789423200000 } from './migrations/1789423200000-team-activity-effects';
import { InternationalTournament } from '../internationals/entities/international-tournament.entity';
import { InternationalFixture } from '../internationals/entities/international-fixture.entity';
import { Club } from '../clubs/entities/club.entity';
import { ClubRoster } from '../clubs/entities/club-roster.entity';
import { CreateClubCatalog1788991200000 } from './migrations/1788991200000-create-club-catalog';
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
import { AddGameCalendar1788300000000 } from './migrations/1788300000000-add-game-calendar';
import { AdjustSplitThreeStart1788303600000 } from './migrations/1788303600000-adjust-split-three-start';
import { CreateCalendarEvents1788386400000 } from './migrations/1788386400000-create-calendar-events';
import { CreatePlayerCatalog1787237754573 } from './migrations/1787237754573-create-player-catalog';
import { CalendarEvent } from '../event-queue/entities/calendar-event.entity';
import { ContractOffer } from '../contracts/entities/contract-offer.entity';
import { PlayerContract } from '../contracts/entities/player-contract.entity';
import { CreateContracts1788472800000 } from './migrations/1788472800000-create-contracts';
import { TransferAgreement } from '../transfers/entities/transfer-agreement.entity';
import { TransferRecord } from '../transfers/entities/transfer-record.entity';
import { CreateTransfers1788559200000 } from './migrations/1788559200000-create-transfers';
import { CreateLegendEvents1788645600000 } from './migrations/1788645600000-create-legend-events';
import { LegendSeason } from '../legends/entities/legend-season.entity';
import { LegendEvent } from '../legends/entities/legend-event.entity';
import { LegendEventPlayer } from '../legends/entities/legend-event-player.entity';
import { AiClubState } from '../ai-clubs/entities/ai-club-state.entity';
import { CreateAiClubs1788732000000 } from './migrations/1788732000000-create-ai-clubs';
import { AddFullSeasonCalendar1788818400000 } from './migrations/1788818400000-add-full-season-calendar';
import { CreateManagerCareer1788904800000 } from './migrations/1788904800000-create-manager-career';
import { ManagerCareerState } from '../manager-career/entities/manager-career-state.entity';
import { ManagerReview } from '../manager-career/entities/manager-review.entity';

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
    SocialIdentity,
    GoogleAuthChallenge,
    Club,
    ClubRoster,
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
    InternationalTournament,
    InternationalFixture,
    Match,
    MatchPlayerStat,
    MatchSeries,
    MatchFeedback,
    MatchFeedbackPlayerEffect,
    LeagueSplit,
    LeagueStage,
    LeagueStageParticipant,
    LeagueFixture,
    CalendarEvent,
    ContractOffer,
    PlayerContract,
    TransferAgreement,
    TransferRecord,
    LegendSeason,
    LegendEvent,
    LegendEventPlayer,
    AiClubState,
    ManagerCareerState,
    ManagerReview,
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
    AddGameCalendar1788300000000,
    AdjustSplitThreeStart1788303600000,
    CreateCalendarEvents1788386400000,
    CreateContracts1788472800000,
    CreateTransfers1788559200000,
    CreateLegendEvents1788645600000,
    CreateAiClubs1788732000000,
    AddFullSeasonCalendar1788818400000,
    CreateManagerCareer1788904800000,
    CreateClubCatalog1788991200000,
    AddGoogleAuth1789077600000,
    WeeklyTraining1789164000000,
    InternationalTournaments1789250400000,
    AddLcpCblol1789336800000,
    TeamActivityEffects1789423200000,
  ],
  migrationsTableName: 'migrations',
  ssl: useSsl ? { rejectUnauthorized: true } : undefined,
  synchronize: false,
});

export default dataSource;
