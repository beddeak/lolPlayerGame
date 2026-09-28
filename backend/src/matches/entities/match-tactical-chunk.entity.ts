import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MatchTacticalRun } from './match-tactical-run.entity';
import type { TacticalReplayChunk } from '../simulation-v2/replay';

@Entity({ name: 'match_tactical_chunks' })
export class MatchTacticalChunk {
  @PrimaryColumn({ type: 'int', unsigned: true })
  runId!: number;

  @PrimaryColumn({ type: 'int', unsigned: true })
  chunkIndex!: number;

  @ManyToOne(() => MatchTacticalRun, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_tactical_chunk_run',
  })
  run!: MatchTacticalRun;

  @Column({ type: 'json' })
  payload!: TacticalReplayChunk;
}
