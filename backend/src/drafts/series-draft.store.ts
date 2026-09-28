import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { MatchSeries } from '../match-series/entities/match-series.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import {
  lockActiveManagerCareer,
  tacticalSeriesExecutionKey,
} from '../manager-career/manager-access';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import {
  applyDraftAction,
  automaticVariant,
  autoCompleteDraft,
  currentTurn,
  DraftTeam,
  DRAFT_TURN_SECONDS,
  applySelection,
  automaticSelection,
  selectionTurn,
  draftTurns,
  SelectionChoice,
  confirmChampionLineup,
} from './draft-state';
import { firstGameSelection } from './first-selection-policy';
import { Position } from '../players/enums/position.enum';
import { RIOT_DATA_VERSION } from './data/riot-champions';
import { CHAMPION_BALANCE_VERSION } from './champion-catalog';

async function owned(manager: EntityManager, accountId: number, id: number) {
  const series = await manager.findOne(MatchSeries, {
    where: { id, career: { accountId } },
    relations: { career: true, games: true },
  });
  if (!series) throw new NotFoundException('경기 시리즈를 찾을 수 없습니다.');
  return series;
}

export async function readSeriesDraft(
  db: DataSource,
  accountId: number,
  id: number,
  game: number,
) {
  const series = await owned(db.manager, accountId, id);
  const draft = series.drafts?.[String(game)];
  if (!draft) throw new NotFoundException('아직 시작하지 않은 밴픽입니다.');
  return { ...draft, turns: draftTurns(draft), serverNow: Date.now() };
}

function toTeam(team: CareerTeam): DraftTeam {
  const starters = team.rosters.filter(
    (slot) => slot.role === RosterRole.STARTER && slot.starterPosition !== null,
  );
  if (
    starters.length !== 5 ||
    !STARTER_POSITIONS.every((position) =>
      starters.some((slot) => slot.starterPosition === position),
    )
  )
    throw new ConflictException('5개 포지션의 선발 선수를 먼저 등록해 주세요.');
  return {
    id: team.id,
    code: team.code,
    strategy: team.teamStrategy,
    players: starters.map((slot) => ({
      id: slot.careerPlayerId,
      nickname: slot.careerPlayer.playerCard.player.nickname,
      position: slot.starterPosition!,
      instruction: slot.playerInstruction,
      roleProficiency: null,
      typeProficiencies: {},
      abilities: {
        mechanics: slot.careerPlayer.currentMechanics,
        laning: slot.careerPlayer.currentLaning,
        teamFight: slot.careerPlayer.currentTeamFight,
      },
    })),
  };
}

/** Career lock serializes tabs, timeout requests and game persistence. */
export async function updateSeriesDraft(
  db: DataSource,
  accountId: number,
  id: number,
  game: number,
  action?: {
    expectedStep: number;
    variantId?: string;
    selection?: { expectedStep: number; choice?: SelectionChoice };
    lineup?: {
      expectedRevision: number;
      entries?: Array<{ position: Position; championId: string }>;
    };
  },
  forSimulation = false,
  // Internal authorized automation only. Never forwarded from a public draft DTO.
  automaticForTesting = false,
) {
  return db.transaction('READ COMMITTED', async (manager) => {
    const initial = await owned(manager, accountId, id);
    await lockActiveManagerCareer(
      manager,
      accountId,
      initial.careerId,
      forSimulation
        ? tacticalSeriesExecutionKey(initial.careerId, id, game)
        : undefined,
    );
    const series = await owned(manager, accountId, id);
    const wins = Math.floor(series.bestOf / 2) + 1;
    if (
      series.games.length + 1 !== game ||
      [series.teamAId, series.teamBId].some(
        (teamId) =>
          series.games.filter((match) => match.winnerTeamId === teamId)
            .length >= wins,
      )
    )
      throw new ConflictException(
        '이미 진행된 세트입니다. 현재 경기 정보를 다시 불러와 주세요.',
      );
    const teams = await manager.find(CareerTeam, {
      where: {
        id: In([series.teamAId, series.teamBId]),
        careerId: series.careerId,
      },
      relations: {
        rosters: { careerPlayer: { playerCard: { player: true } } },
      },
    });
    const managed = teams.find((team) => team.isUserControlled);
    if (!forSimulation && !managed)
      throw new ForbiddenException('내 구단 경기의 밴픽만 조작할 수 있습니다.');
    let draft = series.drafts?.[String(game)];
    if (
      forSimulation &&
      managed &&
      (!draft?.completed ||
        (draft.version === 3 && !draft.assignmentsConfirmed)) &&
      !automaticForTesting
    )
      throw new ConflictException('이 세트의 밴픽을 먼저 완료해 주세요.');
    if (!draft) {
      const firstDraft = series.drafts?.['1'];
      // Never rewrite an existing series' rules midway, including old sets without drafts.
      const modern =
        game === 1 || firstDraft?.version === 2 || firstDraft?.version === 3;
      const champions = game === 1 || firstDraft?.version === 3;
      const previous = series.games.find(
        (m) => m.seriesGameNumber === game - 1,
      );
      const chooser = previous
        ? previous.winnerTeamId === series.teamAId
          ? series.teamBId
          : series.teamAId
        : series.teamAId;
      const selection = !modern
        ? undefined
        : previous
          ? {
              firstSelectionTeamId: chooser,
              policy: 'PREVIOUS_LOSER' as const,
              choices: [],
              blueTeamId: null,
              redTeamId: null,
              firstPickTeamId: null,
              secondPickTeamId: null,
            }
          : await firstGameSelection(manager, series, teams);
      const unavailable =
        modern && series.bestOf > 1
          ? [
              ...new Set(
                series.games.flatMap((m) =>
                  (series.drafts?.[String(m.seriesGameNumber)]?.actions ?? [])
                    .filter((a) => a.kind === 'PICK')
                    .map((a) => a.variantId),
                ),
              ),
            ]
          : [];
      draft = {
        version: champions ? 3 : modern ? 2 : 1,
        ...(champions
          ? {
              aiSeed: series.seed,
              championDataVersion: RIOT_DATA_VERSION,
              balanceVersion: CHAMPION_BALANCE_VERSION,
            }
          : {}),
        blue: toTeam(teams.find((team) => team.id === series.teamAId)!),
        red: toTeam(teams.find((team) => team.id === series.teamBId)!),
        managedTeamId: managed?.id ?? 0,
        gameNumber: game,
        fearless: modern && series.bestOf > 1,
        unavailable,
        actions: [],
        completed: false,
        deadline: new Date(
          Date.now() + DRAFT_TURN_SECONDS * 1000,
        ).toISOString(),
        ...(selection ? { selection } : {}),
      };
    }
    if (draft.managedTeamId !== (managed?.id ?? 0))
      throw new ConflictException('감독 구단이 변경되었습니다.');
    for (const snapshot of [draft.blue, draft.red]) {
      const current = toTeam(teams.find((team) => team.id === snapshot.id)!);
      if (
        snapshot.players.some(
          (player) =>
            !current.players.some(
              (value) =>
                value.id === player.id && value.position === player.position,
            ),
        )
      )
        throw new ConflictException(
          '밴픽 시작 당시 선발 선수와 포지션으로 복구해 주세요.',
        );
    }
    if (action) {
      if (action.lineup) {
        if (!managed)
          throw new ForbiddenException(
            '내 구단의 챔피언만 배치할 수 있습니다.',
          );
        const side = managed.id === draft.blue.id ? 'BLUE' : 'RED';
        const expired =
          !!draft.deadline && Date.parse(draft.deadline) <= Date.now();
        if (!action.lineup.entries && !expired)
          throw new ConflictException('아직 배치 시간이 남아 있습니다.');
        const entries =
          !expired && action.lineup.entries
            ? action.lineup.entries
            : Object.entries(draft.assignments?.[side] ?? {}).map(
                ([position, championId]) => ({
                  position: position as Position,
                  championId,
                }),
              );
        try {
          draft = confirmChampionLineup(
            draft,
            side,
            entries,
            action.lineup.expectedRevision,
          );
        } catch (error) {
          throw new ConflictException(
            error instanceof Error ? error.message : '배치를 확인해 주세요.',
          );
        }
      } else if (action.selection) {
        const turn = selectionTurn(draft);
        if (
          !turn ||
          action.selection.expectedStep !== draft.selection!.choices.length
        )
          throw new ConflictException(
            '이미 처리된 선택권입니다. 현재 상태를 다시 불러와 주세요.',
          );
        const own = turn.teamId === managed?.id;
        const expired = Date.parse(draft.deadline!) <= Date.now();
        if (action.selection.choice && !own)
          throw new ForbiddenException(
            '상대 팀의 선택권을 조작할 수 없습니다.',
          );
        if (!action.selection.choice && own && !expired)
          throw new ConflictException('아직 선택 시간이 남아 있습니다.');
        try {
          draft = applySelection(
            draft,
            !own || expired
              ? automaticSelection(draft)
              : action.selection.choice!,
            !own || expired,
            Date.now(),
          );
        } catch {
          throw new ConflictException(
            '남은 항목에서 진영 또는 픽 순서를 선택해 주세요.',
          );
        }
      } else {
        if (selectionTurn(draft))
          throw new ConflictException('진영과 픽 순서를 먼저 확정해 주세요.');
        if (action.expectedStep !== draft.actions.length)
          throw new ConflictException(
            '이미 처리된 차례입니다. 밴픽을 다시 불러와 주세요.',
          );
        const turn = currentTurn(draft);
        if (!turn || draft.completed)
          throw new ConflictException('밴픽이 이미 완료되었습니다.');
        const own =
          (turn.side === 'BLUE' ? draft.blue.id : draft.red.id) === managed?.id;
        const expired = Date.parse(draft.deadline!) <= Date.now();
        if (action.variantId && !own)
          throw new ForbiddenException('상대 팀의 선택을 변경할 수 없습니다.');
        if (!action.variantId && own && !expired)
          throw new ConflictException('아직 선택 시간이 남아 있습니다.');
        const automatic = !own || expired;
        try {
          draft = applyDraftAction(
            draft,
            automatic ? automaticVariant(draft).id : action.variantId!,
            automatic,
            Date.now(),
          );
        } catch {
          throw new ConflictException(
            '현재 차례에 선택할 수 없는 Variant입니다.',
          );
        }
      }
    }
    if (forSimulation && (!managed || automaticForTesting))
      draft = autoCompleteDraft(draft, Date.now());
    await manager.update(MatchSeries, id, {
      drafts: { ...series.drafts, [String(game)]: draft },
    });
    return { ...draft, turns: draftTurns(draft), serverNow: Date.now() };
  });
}
