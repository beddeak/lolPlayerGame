import { Position } from '../../players/enums/position.enum';
import { TeamStrategy } from '../../careers/enums/team-strategy.enum';
import type { SimpleMatchTeamInput } from '../simulation/simple-match.types';
import { createEngineInput } from './input-adapter';
import type { EngineInput } from './contracts';

/** Synthetic lab fixtures, never inserted into the player/club catalog or a career. */
export function createLabInput(seed = 123): EngineInput {
  const positions = Object.values(Position);
  const team = (teamId: number): SimpleMatchTeamInput => ({
    teamId,
    teamCode: `LAB_${teamId}`,
    teamStrategy: TeamStrategy.BALANCED,
    strategyProficiency: 70,
    chemistry: 70,
    activeSetBonuses: [],
    players: positions.map((position, index) => ({
      careerPlayerId: teamId * 100 + index,
      position,
      form: 50,
      condition: 100,
      mechanics: 85,
      gameSense: 85,
      laning: 85,
      teamFight: 85,
      macro: 85,
      teamPlay: 85,
      mental: 85,
      championPool: 85,
      playerInstruction: null,
      roleProficiency: null,
      positionProficiency: 100,
      championArchetype: null,
    })),
  });
  const teams: [SimpleMatchTeamInput, SimpleMatchTeamInput] = [
    team(1),
    team(2),
  ];
  const champions = [
    'Garen',
    'LeeSin',
    'Ahri',
    'Jinx',
    'Lulu',
    'Darius',
    'Vi',
    'Orianna',
    'Ashe',
    'Nautilus',
  ];
  return structuredClone(
    createEngineInput({
      seed,
      blueTeamId: 1,
      teams,
      picks: teams.flatMap((team, side) =>
        positions.map((position, index) => ({
          teamId: team.teamId,
          position,
          championId: champions[side * 5 + index],
        })),
      ),
    }),
  );
}

export function createDuelInput(seed = 123): EngineInput {
  const input = createLabInput(seed);
  input.controlMode = 'SCRIPTED';
  input.actors = [input.actors[0], input.actors[5]];
  return input;
}
