import { ConflictException, NotFoundException } from '@nestjs/common';
import { gzipSync } from 'node:zlib';
import { DataSource } from 'typeorm';
import { Career } from '../careers/entities/career.entity';
import { TeamStrategy } from '../careers/enums/team-strategy.enum';
import { Match } from './entities/match.entity';
import { MatchTacticalRun } from './entities/match-tactical-run.entity';
import { MatchTacticalChunk } from './entities/match-tactical-chunk.entity';
import { TacticalRunsService } from './tactical-runs.service';
import { createLabInput } from './simulation-v2/test-fixtures';
import { createBattleRuleset } from './simulation-v2/battle-rules';
import {
  queueCommand,
  runUntil,
  startSimulation,
} from './simulation-v2/engine';
import { canonicalHash } from './simulation-v2/seeded-rng';
import { checkpoint } from './simulation-v2/world-state';
import { projectMatch } from './simulation-v2/projection';
import { buildCareerEngineInput } from './simulation-v2/career-input';
import type { SimpleMatchTeamInput } from './simulation/simple-match.types';

function setup() {
  const input = createLabInput(719);
  input.rules = createBattleRuleset();
  input.controlMode = 'SCRIPTED';
  const state = startSimulation(input);
  const actor = state.actors[0];
  const nexus = state.units.find(
    (unit) => unit.kind === 'NEXUS' && unit.side === 'RED',
  )!;
  for (const unit of state.units.filter(
    (unit) => unit.structure && unit.side === 'RED' && unit.id !== nexus.id,
  )) {
    unit.hp = 0;
    unit.active = false;
  }
  nexus.hp = 1;
  actor.position = { ...nexus.position };
  queueCommand(state, {
    id: 'final-attack',
    atMs: 1100,
    intent: {
      kind: 'ATTACK',
      actorId: actor.id,
      targetId: nexus.id,
      reason: 'Storage resume fixture',
    },
  });
  runUntil(state, 1000);
  const teams = input.teams.map((team) => team.sourceTeam!) as [
    SimpleMatchTeamInput,
    SimpleMatchTeamInput,
  ];
  const draft = buildCareerEngineInput({
    teams,
    seed: input.seed,
    careerId: 1,
    gameId: 1,
  }).draft;
  const dto = { careerId: 1, teamAId: 1, teamBId: 2, seed: input.seed };
  const run = {
    id: 45,
    executionKey: canonicalHash(dto),
    careerId: 1,
    matchId: null,
    status: 'RUNNING',
    engineVersion: input.engineVersion,
    inputHash: canonicalHash(input),
    input,
    currentMeta: TeamStrategy.BALANCED,
    simTimeMs: state.simTimeMs,
    draft,
    feedbackIds: [],
    checkpoint: gzipSync(Buffer.from(JSON.stringify(checkpoint(state)))),
    manifest: null,
    error: null,
    leaseToken: null,
    leaseExpiresAt: new Date(0),
  } as unknown as MatchTacticalRun;
  const chunks: MatchTacticalChunk[] = [];
  const manager = {
    findOne: jest.fn(async (entity: unknown, options: any) => {
      if (entity === Career)
        return options.where.accountId === 7 ? { id: 1, accountId: 7 } : null;
      if (entity === Match)
        return options.where.career.accountId === 7 ? { id: 99 } : null;
      if (entity === MatchTacticalRun) {
        if (
          options.select &&
          options.where.executionKey?.value === run.executionKey
        )
          return null;
        return { ...run };
      }
      return null;
    }),
    findOneBy: jest.fn(async (entity: unknown, where: any) => {
      if (entity === MatchTacticalRun)
        return run.matchId === where.matchId ? { ...run } : null;
      if (entity === MatchTacticalChunk)
        return (
          chunks.find(
            (chunk) =>
              chunk.runId === where.runId &&
              chunk.chunkIndex === where.chunkIndex,
          ) ?? null
        );
      return null;
    }),
    update: jest.fn(async (_entity: unknown, where: any, data: any) => {
      if (where.leaseToken && where.leaseToken !== run.leaseToken)
        return { affected: 0 };
      Object.assign(run, data);
      return { affected: 1 };
    }),
    create: jest.fn((_entity: unknown, value: any) => value),
    save: jest.fn(async (entity: unknown, value: any) => {
      if (entity === MatchTacticalRun) {
        Object.assign(run, value);
        return { ...run };
      }
      if (entity === MatchTacticalChunk) chunks.push(...value);
      return value;
    }),
    getRepository: jest.fn(() => ({
      createQueryBuilder: () => {
        const builder = {
          addSelect: () => builder,
          where: () => builder,
          getOne: async () => ({ ...run }),
        };
        return builder;
      },
    })),
  };
  const db = {
    manager,
    getRepository: manager.getRepository,
    transaction: async (
      work: (entityManager: typeof manager) => Promise<unknown>,
    ) => work(manager),
  } as unknown as DataSource;
  return {
    service: new TacticalRunsService(db),
    run,
    manager,
    chunks,
    state,
    teams,
    dto,
  };
}

describe('durable tactical execution and replay ownership', () => {
  it('resumes the persisted world and RNG, then stores one exact report/chunk set without career rewards', async () => {
    const test = setup();
    runUntil(test.state, 2000);
    const expected = projectMatch(test.state);
    const result = await test.service.simulate(
      7,
      test.dto,
      test.teams,
      TeamStrategy.BALANCED,
    );
    expect(result.status).toBe('FINISHED');
    expect(result.manifest!.report).toEqual(expected);
    expect(test.chunks.length).toBeGreaterThan(0);
    expect(
      test.manager.update.mock.calls.every(
        ([entity]) => entity === MatchTacticalRun,
      ),
    ).toBe(true);
    const writes = test.manager.save.mock.calls.length;
    const second = await test.service.simulate(
      7,
      test.dto,
      test.teams,
      TeamStrategy.BALANCED,
    );
    expect(second.manifest).toEqual(result.manifest);
    expect(test.manager.save).toHaveBeenCalledTimes(writes);
  });

  it('refuses another process live lease without recalculating or issuing another write', async () => {
    const test = setup();
    test.run.leaseExpiresAt = new Date(Date.now() + 120_000);
    test.run.leaseToken = 'other-process';
    await expect(
      test.service.simulate(7, test.dto, test.teams, TeamStrategy.BALANCED),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(test.manager.save).not.toHaveBeenCalled();
    expect(test.manager.update).not.toHaveBeenCalled();
  });

  it('checks save ownership before inspecting an execution or loading replay chunks', async () => {
    const test = setup();
    await expect(
      test.service.simulate(8, test.dto, test.teams, TeamStrategy.BALANCED),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(test.service.findChunk(8, 99, 0)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(test.manager.getRepository).not.toHaveBeenCalled();
    expect(test.manager.findOneBy).not.toHaveBeenCalled();
  });

  it('exposes saved old matches as unavailable without executing the newer engine', async () => {
    const test = setup();
    const response = await test.service.findOne(7, 99);
    expect(response.status).toBe('UNAVAILABLE');
    expect(response.manifest).toBeNull();
    expect(test.manager.update).not.toHaveBeenCalled();
  });

  it('keeps a corrupt checkpoint as ERROR without writing any completed report or match', async () => {
    const test = setup();
    test.run.checkpoint = gzipSync(
      Buffer.from(
        JSON.stringify({
          checkpointVersion: 1,
          hash: 'invalid',
          state: test.state,
        }),
      ),
    );
    await expect(
      test.service.simulate(7, test.dto, test.teams, TeamStrategy.BALANCED),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(test.run.status).toBe('ERROR');
    expect(test.run.error).toMatch(/Corrupt/);
    expect(test.run.manifest).toBeNull();
    expect(test.chunks).toEqual([]);
    expect(test.run.matchId).toBeNull();
  });

  it('returns an already committed run without changing the frozen input after career stats changed', async () => {
    const test = setup();
    test.run.matchId = 99;
    test.run.status = 'FINISHED';
    const inputHash = canonicalHash(test.run.input);
    const changed = structuredClone(test.teams);
    changed[0].players[0].mechanics = 1;
    const run = await test.service.simulate(
      7,
      test.dto,
      changed,
      TeamStrategy.BOT_CARRY,
    );
    expect(run.matchId).toBe(99);
    expect(canonicalHash(run.input)).toBe(inputHash);
    expect(run.currentMeta).toBe(TeamStrategy.BALANCED);
    expect(test.manager.save).not.toHaveBeenCalled();
  });

  it('retries a transient archive write failure from the last committed checkpoint', async () => {
    const test = setup();
    const save = test.manager.save.getMockImplementation()!;
    let unavailable = true;
    test.manager.save.mockImplementation(async (entity, value) => {
      if (entity === MatchTacticalChunk && unavailable) {
        unavailable = false;
        throw new Error('Temporary database connection failure');
      }
      return save(entity, value);
    });
    await expect(
      test.service.simulate(7, test.dto, test.teams, TeamStrategy.BALANCED),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(test.run.status).toBe('RUNNING');
    expect(test.run.checkpoint).not.toBeNull();
    expect(test.run.matchId).toBeNull();
    const result = await test.service.simulate(
      7,
      test.dto,
      test.teams,
      TeamStrategy.BALANCED,
    );
    expect(result.status).toBe('FINISHED');
    expect(test.chunks.length).toBe(result.manifest!.chunks.length);
  });

  it('detects a mutated replay payload against the committed manifest', async () => {
    const test = setup();
    await test.service.simulate(7, test.dto, test.teams, TeamStrategy.BALANCED);
    test.run.matchId = 99;
    await expect(test.service.findChunk(7, 99, 0)).resolves.toEqual(
      test.chunks[0].payload,
    );
    test.chunks[0].payload.inputHash = 'foreign-world';
    await expect(test.service.findChunk(7, 99, 0)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('stores an incomplete horizon diagnostic without inventing a winning match', async () => {
    const test = setup();
    const input = createLabInput(719);
    input.rules.maxHorizonMs = 1000;
    input.controlMode = 'SCRIPTED';
    test.run.input = input;
    test.run.inputHash = canonicalHash(input);
    test.run.checkpoint = gzipSync(
      Buffer.from(JSON.stringify(checkpoint(startSimulation(input)))),
    );
    await expect(
      test.service.simulate(7, test.dto, test.teams, TeamStrategy.BALANCED),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(test.run.status).toBe('HORIZON_REACHED');
    expect(test.run.manifest!.winnerTeamId).toBeNull();
    expect(test.run.checkpoint).not.toBeNull();
    expect(test.run.matchId).toBeNull();
  });
});
