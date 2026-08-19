import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { Position } from "../eunms/player-eunms.eunm";

@Entity()
export class Player {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: Position })
  position!: Position;

  @Column({ default: 18 })
  age!: number;

  // 기본 능력치
  @Column({ default: 50 })
  mechanics!: number; // 피지컬과 스킬 조작 능력

  @Column({ default: 50 })
  gameSense!: number; // 지금 이 상황에서 무엇을 해야 하는지 판단하는 능력

  @Column({ default: 50 })
  laning!: number; // 라인전 수행 능력

  @Column({ default: 50 })
  teamFight!: number; // 실제 5:5 교전 수행 능력

  @Column({ default: 50 })
  macro!: number; // 앞으로 팀이 어디로 움직여야 하는지 판단하는 운영 능력

  @Column({ default: 50 })
  teamPlay!: number; // 팀원과의 호흡, 연계 및 합류 능력

  @Column({ default: 50 })
  mental!: number; // 압박과 불리한 상황을 견디는 정신력

  // 성장 한계
  @Column({ default: 70 })
  potential!: number;

  // 일시적인 상태
  @Column({ default: 50 })
  form!: number;

  @Column({ default: 100 })
  condition!: number;
}
