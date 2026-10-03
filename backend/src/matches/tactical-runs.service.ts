import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { DataSource, In } from 'typeorm';
import { lockActiveManagerCareer } from '../manager-career/manager-access';
import type { TeamStrategy } from '../careers/enums/team-strategy.enum';
import type { SimpleMatchTeamInput } from './simulation/simple-match.types';
import type { MatchSeriesGameContext } from './matches.service';
import type { SimulateMatchDto } from './dto/simulate-match.dto';
import { Match } from './entities/match.entity';
import { MatchTacticalRun } from './entities/match-tactical-run.entity';
import { MatchTacticalChunk } from './entities/match-tactical-chunk.entity';
import { ENGINE_VERSION } from './simulation-v2/contracts';
import { startSimulation, runUntil } from './simulation-v2/engine';
import {
  restoreCheckpoint,
  type SimulationCheckpoint,
} from './simulation-v2/world-state';
import { canonicalHash } from './simulation-v2/seeded-rng';
import { buildReplayArchive } from './simulation-v2/replay';
import {
  buildCareerEngineInput,
  careerMacroAi,
} from './simulation-v2/career-input';
import { checkpointDue, packTacticalCheckpoint } from './tactical-checkpoint';

const decompress = promisify(gunzip);
const yieldEventLoop = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
const LEASE_MS = 120_000;

/** Durable input/lease/checkpoint boundaries surround a yielding, DB-free core. */
@Injectable()
export class TacticalRunsService implements OnModuleDestroy {
  private activeJobs = 0;
  private stopping = false;
  constructor(private readonly dataSource: DataSource) {}
  onModuleDestroy(): void {
    this.stopping = true;
  }

  async simulate(
    accountId: number,
    dto: SimulateMatchDto,
    teams: [SimpleMatchTeamInput, SimpleMatchTeamInput],
    currentMeta: TeamStrategy,
    context?: MatchSeriesGameContext,
  ): Promise<MatchTacticalRun> {
    const executionKey = canonicalHash(
      context
        ? {
            careerId: dto.careerId,
            seriesId: context.series.id,
            gameNumber: context.gameNumber,
          }
        : {
            careerId: dto.careerId,
            teamAId: dto.teamAId,
            teamBId: dto.teamBId,
            seed: dto.seed,
          },
    );
    const token = randomUUID();
    let claimed = false;
    const run = await this.dataSource
      .transaction(async (manager) => {
        // Career locks serialize execution creation, draft/feedback changes and final match writes.
        await lockActiveManagerCareer(
          manager,
          accountId,
          dto.careerId,
          executionKey,
        );
        let current = await manager
          .getRepository(MatchTacticalRun)
          .createQueryBuilder('run')
          .addSelect('run.input')
          .where('run.executionKey = :executionKey', { executionKey })
          .getOne();
        // A committed Match is already idempotent. Uncommitted executions still
        // feed their pinned input into career-result adaptation, so validate it
        // even when a valid checkpoint or completed archive already exists.
        if (current?.matchId) return current;
        if (
          current &&
          (current.status === 'RUNNING' || current.status === 'FINISHED')
        )
          this.assertPinnedInput(current);
        if (current?.status === 'FINISHED') return current;
        if (current && current.status !== 'RUNNING')
          throw this.incomplete(current);
        if (current && (current.leaseExpiresAt?.getTime() ?? 0) > Date.now())
          throw new ConflictException({
            message:
              '경기를 계산 중입니다. 잠시 후 같은 세트를 다시 불러와 주세요.',
            runId: current.id,
            status: 'RUNNING',
          });
        if (this.activeJobs >= 1 || this.stopping)
          throw new ServiceUnavailableException(
            '다른 경기를 계산 중입니다. 잠시 후 다시 진행해 주세요.',
          );
        this.activeJobs++;
        claimed = true;
        if (!current) {
          current = await manager.save(
            MatchTacticalRun,
            manager.create(MatchTacticalRun, {
              executionKey,
              careerId: dto.careerId,
              matchId: null,
              status: 'RUNNING',
              engineVersion: ENGINE_VERSION,
              input: null,
              inputHash: '',
              currentMeta,
              feedbackIds: context?.feedbackIds ?? [],
              draft: context?.draft ?? {},
              simTimeMs: 0,
              checkpoint: null,
              manifest: null,
              error: null,
              leaseToken: null,
              leaseExpiresAt: null,
            }),
          );
          let previous: MatchTacticalRun[] = [];
          if (context) {
            const previousMatches = await manager.find(Match, {
              where: { seriesId: context.series.id },
            });
            if (previousMatches.length)
              previous = await manager
                .getRepository(MatchTacticalRun)
                .createQueryBuilder('run')
                .addSelect('run.input')
                .where({
                  matchId: In(previousMatches.map((match) => match.id)),
                })
                .getMany();
          }
          if (previous.some((played) => !played.input))
            throw new ConflictException(
              '이전 세트의 고정 경기 입력을 확인할 수 없습니다.',
            );
          let built: ReturnType<typeof buildCareerEngineInput>;
          try {
            built = buildCareerEngineInput({
              teams,
              seed: dto.seed,
              careerId: dto.careerId,
              seriesId: context?.series.id,
              gameId: current.id,
              draft: context?.draft,
              macroAi: careerMacroAi(previous.map((played) => played.input!)),
            });
          } catch (error) {
            throw new ConflictException(
              error instanceof Error
                ? error.message
                : '경기 입력을 검증하지 못했습니다.',
            );
          }
          current.input = built.input;
          current.draft = built.draft;
          current.inputHash = canonicalHash(current.input);
          if (previous.length) {
            const environment = (
              input: NonNullable<MatchTacticalRun['input']>,
            ) =>
              canonicalHash({
                engineVersion: input.engineVersion,
                catalogVersion: input.catalogVersion,
                balanceVersion: input.balanceVersion,
                rules: input.rules,
                map: input.map,
                meta: input.meta ?? null,
              });
            if (
              previous.some(
                (played) =>
                  !played.input ||
                  environment(played.input) !== environment(built.input),
              )
            )
              throw new ConflictException(
                '시리즈 도중 엔진·룰셋·메타 버전이 변경되어 다음 세트를 시작할 수 없습니다.',
              );
          }
        }
        if (current.engineVersion !== ENGINE_VERSION || !current.input)
          throw new ConflictException(
            '저장된 경기의 엔진 버전을 현재 실행기로 재개할 수 없습니다. 기존 결과는 보존됩니다.',
          );
        current.leaseToken = token;
        current.leaseExpiresAt = new Date(Date.now() + LEASE_MS);
        return manager.save(MatchTacticalRun, current);
      })
      .catch((error) => {
        if (claimed) this.activeJobs--;
        throw error;
      });
    if (!claimed) return run;
    try {
      await yieldEventLoop();
      const finished = await this.execute(run, token);
      if (finished.status !== 'FINISHED') throw this.incomplete(finished);
      return finished;
    } finally {
      this.activeJobs--;
    }
  }

  private assertPinnedInput(run: MatchTacticalRun): void {
    let actualHash: string | null = null;
    try {
      if (run.input) actualHash = canonicalHash(run.input);
    } catch {
      // Preserve the original input/checkpoint for diagnosis, never re-hash
      // corrupt data into a new accepted baseline or overwrite it on retry.
    }
    if (actualHash !== run.inputHash)
      throw new ConflictException(
        '저장된 경기 입력의 무결성을 확인할 수 없습니다. 기존 입력과 체크포인트는 보존됩니다.',
      );
    if (run.status === 'FINISHED' && run.manifest?.inputHash !== run.inputHash)
      throw new ConflictException(
        '저장된 경기 결과의 입력이 일치하지 않습니다. 기존 결과는 보존됩니다.',
      );
  }

  private incomplete(run: MatchTacticalRun): ConflictException {
    return new ConflictException({
      message:
        run.status === 'HORIZON_REACHED'
          ? '제한 시간까지 넥서스가 파괴되지 않아 경기가 완료되지 않았습니다. 승패와 커리어 보상은 저장하지 않았습니다.'
          : '경기 계산을 완료하지 못했습니다. 저장된 입력과 체크포인트로 원인을 확인할 수 있습니다.',
      runId: run.id,
      status: run.status,
      simTimeMs: run.simTimeMs,
    });
  }

  async findOne(accountId: number, matchId: number) {
    await this.ownedMatch(accountId, matchId);
    const run = await this.dataSource.manager.findOneBy(MatchTacticalRun, {
      matchId,
    });
    return {
      matchId,
      runId: run?.id ?? null,
      status: run?.status ?? 'UNAVAILABLE',
      engineVersion: run?.engineVersion ?? null,
      simTimeMs: run?.simTimeMs ?? 0,
      error:
        run?.error ??
        (run
          ? null
          : '이 경기는 이전 엔진으로 저장되어 새 엔진 리플레이가 없습니다.'),
      manifest: run?.manifest ?? null,
    };
  }

  async findChunk(accountId: number, matchId: number, index: number) {
    await this.ownedMatch(accountId, matchId);
    if (!Number.isSafeInteger(index) || index < 0)
      throw new NotFoundException('Replay chunk not found');
    const run = await this.dataSource.manager.findOneBy(MatchTacticalRun, {
      matchId,
    });
    const chunk =
      run &&
      (await this.dataSource.manager.findOneBy(MatchTacticalChunk, {
        runId: run.id,
        chunkIndex: index,
      }));
    if (!chunk) throw new NotFoundException('Replay chunk not found');
    const descriptor = run.manifest?.chunks.find(
      (entry) => entry.index === index,
    );
    const payload = chunk.payload;
    if (
      !descriptor ||
      payload.index !== index ||
      payload.inputHash !== run.inputHash ||
      payload.fromMs !== descriptor.fromMs ||
      payload.toMs !== descriptor.toMs ||
      canonicalHash(payload) !== descriptor.hash ||
      Buffer.byteLength(JSON.stringify(payload)) !== descriptor.bytes
    )
      throw new ConflictException(
        '저장된 리플레이 청크의 무결성을 확인할 수 없습니다.',
      );
    return chunk.payload;
  }

  private async ownedMatch(accountId: number, matchId: number): Promise<void> {
    const match = await this.dataSource.manager.findOne(Match, {
      where: { id: matchId, career: { accountId } },
    });
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
  }

  private async execute(
    run: MatchTacticalRun,
    token: string,
  ): Promise<MatchTacticalRun> {
    const id = run.id;
    let coreFailure = false;
    const core = <T>(operation: () => T): T => {
      try {
        return operation();
      } catch (error) {
        coreFailure = true;
        throw error;
      }
    };
    try {
      const savedRun = await this.dataSource
        .getRepository(MatchTacticalRun)
        .createQueryBuilder('run')
        .addSelect('run.checkpoint')
        .where('run.id = :id AND run.leaseToken = :token', { id, token })
        .getOne();
      if (!savedRun)
        throw new Error('Execution lease no longer belongs to this process');
      let serialized: string | null = null;
      if (savedRun.checkpoint) {
        try {
          serialized = (await decompress(savedRun.checkpoint)).toString('utf8');
        } catch (error) {
          coreFailure = true;
          throw error;
        }
      }
      const state = core(() =>
        serialized
          ? restoreCheckpoint(JSON.parse(serialized) as SimulationCheckpoint)
          : startSimulation(run.input!),
      );
      core(() => {
        if (state.inputHash !== run.inputHash)
          throw new Error(
            'Checkpoint does not belong to the saved match input',
          );
      });
      let savedAtMs = state.simTimeMs;
      let heartbeatAt = Date.now();
      let savedAtWallMs = heartbeatAt;
      while (state.status === 'RUNNING') {
        if (this.stopping)
          throw new Error(
            'Server is stopping; the last committed checkpoint is preserved',
          );
        core(() =>
          runUntil(
            state,
            Math.min(state.simTimeMs + 1_000, state.input.rules.maxHorizonMs),
          ),
        );
        if (
          checkpointDue(
            state.simTimeMs - savedAtMs,
            Date.now() - savedAtWallMs,
          ) &&
          state.status === 'RUNNING'
        ) {
          const saved = await packTacticalCheckpoint(state);
          const updated = await this.dataSource.manager.update(
            MatchTacticalRun,
            { id, leaseToken: token, status: 'RUNNING' },
            {
              checkpoint: saved,
              simTimeMs: state.simTimeMs,
              leaseExpiresAt: new Date(Date.now() + LEASE_MS),
            },
          );
          if (updated.affected !== 1)
            throw new Error('Execution lease was lost');
          savedAtMs = state.simTimeMs;
          heartbeatAt = Date.now();
          savedAtWallMs = heartbeatAt;
        } else if (Date.now() - heartbeatAt >= 5_000) {
          const updated = await this.dataSource.manager.update(
            MatchTacticalRun,
            { id, leaseToken: token, status: 'RUNNING' },
            { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
          );
          if (updated.affected !== 1)
            throw new Error('Execution lease was lost');
          heartbeatAt = Date.now();
        }
        await yieldEventLoop();
      }
      const archive = core(() => buildReplayArchive(state));
      for (const actor of archive.manifest.actors) {
        const team = [run.draft.blue, run.draft.red].find(
          (entry) => entry.id === actor.teamId,
        );
        actor.name =
          team?.players.find((player) => player.id === actor.careerPlayerId)
            ?.nickname ?? actor.name;
      }
      const diagnosticCheckpoint =
        state.status === 'FINISHED'
          ? null
          : await packTacticalCheckpoint(state);
      await this.dataSource.transaction(async (manager) => {
        const current = await manager.findOne(MatchTacticalRun, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !current ||
          current.leaseToken !== token ||
          current.status !== 'RUNNING'
        )
          throw new Error('Execution lease was lost before final commit');
        const chunks = archive.chunks.map((payload, chunkIndex) =>
          manager.create(MatchTacticalChunk, {
            runId: id,
            chunkIndex,
            payload,
          }),
        );
        if (chunks.length) await manager.save(MatchTacticalChunk, chunks);
        run.status = state.status === 'RUNNING' ? 'ERROR' : state.status;
        run.simTimeMs = state.simTimeMs;
        run.manifest = archive.manifest;
        run.error = state.error;
        await manager.update(
          MatchTacticalRun,
          { id, leaseToken: token },
          {
            status: run.status,
            simTimeMs: run.simTimeMs,
            manifest: run.manifest,
            error: run.error,
            checkpoint: diagnosticCheckpoint,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        );
      });
      return run;
    } catch (error) {
      const retryable = this.stopping || !coreFailure;
      const message = retryable
        ? 'Execution interrupted; retry resumes the last committed checkpoint.'
        : (error instanceof Error
            ? error.message
            : 'Unknown simulation failure'
          ).slice(0, 1_000);
      // Shutdown is retryable; uncommitted steps are discarded on lease expiry/restart.
      try {
        await this.dataSource.manager.update(
          MatchTacticalRun,
          { id, leaseToken: token, status: 'RUNNING' },
          {
            status: retryable ? 'RUNNING' : 'ERROR',
            error: message,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        );
      } catch {
        /* A database outage leaves the persisted lease to expire naturally. */
      }
      run.status = retryable ? 'RUNNING' : 'ERROR';
      run.error = message;
      return run;
    }
  }
}
