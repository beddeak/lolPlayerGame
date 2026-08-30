import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Match } from '../matches/entities/match.entity';
import { MatchPlayerStat } from '../matches/entities/match-player-stat.entity';
import { PlayerPersonality } from '../players/enums/player-personality.enum';
import { MatchFeedbackPlayerEffect } from './entities/match-feedback-player-effect.entity';
import { MatchFeedback } from './entities/match-feedback.entity';
import { MatchSeries } from './entities/match-series.entity';
import { FeedbackOption } from './enums/feedback-option.enum';
import { FeedbackType } from './enums/feedback-type.enum';
import { MatchFeedbackService } from './match-feedback.service';

describe('MatchFeedbackService', () => {
  const career = { id: 1, accountId: 7 };
  const teamA = {
    id: 1,
    careerId: 1,
    career,
    code: 'TEAM_A',
    isUserControlled: true,
  } as CareerTeam;
  const teamB = {
    id: 2,
    careerId: 1,
    career,
    code: 'TEAM_B',
    isUserControlled: false,
  } as CareerTeam;
  const personalities = Object.values(PlayerPersonality);
  const careerPlayers = personalities.map(
    (personality, index) =>
      ({
        id: 101 + index,
        careerId: 1,
        currentTeamId: teamA.id,
        currentMental: 50,
        form: 50,
        condition: 95,
        personality,
        coachTrust: 50,
      }) as CareerPlayer,
  );
  const game1 = {
    id: 11,
    seriesId: 10,
    seriesGameNumber: 1,
    winnerTeamId: teamA.id,
    playerStats: [
      ...careerPlayers.map(
        (careerPlayer) =>
          ({
            careerPlayerId: careerPlayer.id,
            careerTeamId: teamA.id,
          }) as MatchPlayerStat,
      ),
      ...careerPlayers.map(
        (careerPlayer, index) =>
          ({
            careerPlayerId: 201 + index,
            careerTeamId: teamB.id,
          }) as MatchPlayerStat,
      ),
    ],
  } as Match;
  const series = {
    id: 10,
    careerId: 1,
    career,
    teamAId: teamA.id,
    teamA,
    teamBId: teamB.id,
    teamB,
    games: [game1],
  } as unknown as MatchSeries;
  const matchSeriesRepository = {
    findOne: jest.fn(),
  };
  const feedbackRepository = {
    find: jest.fn(),
  };
  const manager = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    find: jest.fn(),
    create: jest.fn((_entity: unknown, value: Record<string, unknown>) => ({
      ...value,
    })),
    save: jest.fn((entity: unknown, value: unknown) => {
      if (entity === MatchFeedback) {
        Object.assign(value as object, {
          id: 77,
          createdAt: new Date('2026-08-28T00:00:00.000Z'),
        });
      }

      return Promise.resolve(value);
    }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const dataSource = {
    transaction: jest.fn(
      (work: (entityManager: typeof manager) => Promise<unknown>) =>
        work(manager),
    ),
  };

  let service: MatchFeedbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    series.games = [game1];
    manager.findOne.mockResolvedValue(series);
    manager.findOneBy.mockResolvedValue(null);
    manager.find.mockResolvedValue(careerPlayers);
    matchSeriesRepository.findOne.mockResolvedValue(series);
    feedbackRepository.find.mockResolvedValue([]);
    service = new MatchFeedbackService(
      matchSeriesRepository as unknown as Repository<MatchSeries>,
      feedbackRepository as unknown as Repository<MatchFeedback>,
      dataSource as unknown as DataSource,
    );
  });

  it('applies individual feedback only to the selected player', async () => {
    manager.find.mockResolvedValue([careerPlayers[2]]);

    const result = await service.create(7, series.id, {
      type: FeedbackType.INDIVIDUAL,
      option: FeedbackOption.DEMAND_CARRY,
      careerPlayerId: careerPlayers[2].id,
    });

    expect(result.type).toBe(FeedbackType.INDIVIDUAL);
    expect(result.targetCareerPlayerId).toBe(careerPlayers[2].id);
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].formDelta).toBeGreaterThan(0);
    expect(manager.update).toHaveBeenCalledTimes(1);
  });

  it('makes all five starters react individually to team feedback', async () => {
    const result = await service.create(7, series.id, {
      type: FeedbackType.TEAM,
      option: FeedbackOption.ABUSIVE_TEAM,
    });
    const sensitive = result.effects.find(
      (effect) => effect.personality === PlayerPersonality.SENSITIVE,
    )!;
    const professional = result.effects.find(
      (effect) => effect.personality === PlayerPersonality.PROFESSIONAL,
    )!;

    expect(result.effects).toHaveLength(5);
    expect(manager.update).toHaveBeenCalledTimes(5);
    expect(Math.abs(sensitive.mentalDelta)).toBeGreaterThan(
      Math.abs(professional.mentalDelta),
    );
  });

  it('rejects a feedback option from the wrong feedback type', async () => {
    await expect(
      service.create(7, series.id, {
        type: FeedbackType.TEAM,
        option: FeedbackOption.TRUST_PLAYER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects feedback before Game 1 and after the series is complete', async () => {
    series.games = [];

    await expect(
      service.create(7, series.id, {
        type: FeedbackType.TEAM,
        option: FeedbackOption.REFOCUS_TEAM,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    series.games = [
      game1,
      {
        ...game1,
        id: 12,
        seriesGameNumber: 2,
        winnerTeamId: teamA.id,
      },
    ];

    await expect(
      service.create(7, series.id, {
        type: FeedbackType.TEAM,
        option: FeedbackOption.REFOCUS_TEAM,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects duplicate feedback at the same game break', async () => {
    manager.findOneBy.mockResolvedValue({ id: 99 });

    await expect(
      service.create(7, series.id, {
        type: FeedbackType.TEAM,
        option: FeedbackOption.REFOCUS_TEAM,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hides feedback history outside the owning account', async () => {
    matchSeriesRepository.findOne.mockResolvedValue(null);

    await expect(service.findAll(8, series.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('stores effect rows before updating CareerPlayer state', async () => {
    await service.create(7, series.id, {
      type: FeedbackType.TEAM,
      option: FeedbackOption.REFOCUS_TEAM,
    });

    expect(manager.save).toHaveBeenCalledWith(
      MatchFeedbackPlayerEffect,
      expect.any(Array),
    );
  });
});
