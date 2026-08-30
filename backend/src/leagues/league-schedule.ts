export interface LeagueScheduleSlot {
  roundNumber: number;
  teamAId: number;
  teamBId: number;
}

export interface SwissTeamSeed {
  teamId: number;
  wins: number;
  seed: number;
}

export function createRoundRobinSchedule(
  orderedTeamIds: number[],
  cycles = 1,
): LeagueScheduleSlot[] {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError('Round-robin cycles must be a positive integer');
  }

  const firstLeg = createSingleRoundRobinSchedule(orderedTeamIds);
  const roundsPerCycle =
    orderedTeamIds.length % 2 === 0
      ? Math.max(orderedTeamIds.length - 1, 0)
      : orderedTeamIds.length;

  return Array.from({ length: cycles }, (_, cycleIndex) =>
    firstLeg.map((slot) => ({
      roundNumber: slot.roundNumber + cycleIndex * roundsPerCycle,
      teamAId: cycleIndex % 2 === 0 ? slot.teamAId : slot.teamBId,
      teamBId: cycleIndex % 2 === 0 ? slot.teamBId : slot.teamAId,
    })),
  ).flat();
}

export function createDoubleRoundRobinSchedule(
  orderedTeamIds: number[],
): LeagueScheduleSlot[] {
  return createRoundRobinSchedule(orderedTeamIds, 2);
}

function createSingleRoundRobinSchedule(
  orderedTeamIds: number[],
): LeagueScheduleSlot[] {
  const rotation: Array<number | null> = [...orderedTeamIds];

  if (rotation.length % 2 !== 0) {
    rotation.push(null);
  }

  const firstLeg: LeagueScheduleSlot[] = [];
  const roundsPerLeg = rotation.length - 1;
  const matchesPerRound = rotation.length / 2;

  for (let roundIndex = 0; roundIndex < roundsPerLeg; roundIndex += 1) {
    for (let pairIndex = 0; pairIndex < matchesPerRound; pairIndex += 1) {
      const left = rotation[pairIndex];
      const right = rotation[rotation.length - 1 - pairIndex];

      if (left === null || right === null) {
        continue;
      }

      const shouldReverse = (roundIndex + pairIndex) % 2 !== 0;
      firstLeg.push({
        roundNumber: roundIndex + 1,
        teamAId: shouldReverse ? right : left,
        teamBId: shouldReverse ? left : right,
      });
    }

    rotation.splice(1, 0, rotation.pop()!);
  }

  return firstLeg;
}

export function createCrossGroupSchedule(
  firstGroupTeamIds: number[],
  secondGroupTeamIds: number[],
  cycles = 1,
): LeagueScheduleSlot[] {
  const slots: LeagueScheduleSlot[] = [];
  const matchesPerRound = Math.max(
    firstGroupTeamIds.length,
    secondGroupTeamIds.length,
  );

  if (matchesPerRound === 0) {
    return slots;
  }

  for (let cycleIndex = 0; cycleIndex < cycles; cycleIndex += 1) {
    for (
      let leftIndex = 0;
      leftIndex < firstGroupTeamIds.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = 0;
        rightIndex < secondGroupTeamIds.length;
        rightIndex += 1
      ) {
        const left = firstGroupTeamIds[leftIndex];
        const right = secondGroupTeamIds[rightIndex];
        const reverse = cycleIndex % 2 !== 0;

        slots.push({
          roundNumber:
            cycleIndex * matchesPerRound +
            ((rightIndex - leftIndex + matchesPerRound) % matchesPerRound) +
            1,
          teamAId: reverse ? right : left,
          teamBId: reverse ? left : right,
        });
      }
    }
  }

  return slots.sort(
    (left, right) =>
      left.roundNumber - right.roundNumber || left.teamAId - right.teamAId,
  );
}

export function createSeededPairings(
  orderedTeamIds: number[],
  roundNumber: number,
): LeagueScheduleSlot[] {
  const pairings: LeagueScheduleSlot[] = [];

  for (
    let pairIndex = 0;
    pairIndex < Math.floor(orderedTeamIds.length / 2);
    pairIndex += 1
  ) {
    pairings.push({
      roundNumber,
      teamAId: orderedTeamIds[pairIndex],
      teamBId: orderedTeamIds[orderedTeamIds.length - 1 - pairIndex],
    });
  }

  return pairings;
}

export function createSwissRoundSchedule(
  teams: SwissTeamSeed[],
  previousPairings: ReadonlySet<string>,
  roundNumber: number,
): LeagueScheduleSlot[] {
  const remaining = [...teams].sort(
    (left, right) => right.wins - left.wins || left.seed - right.seed,
  );
  const slots: LeagueScheduleSlot[] = [];

  while (remaining.length >= 2) {
    const first = remaining.shift()!;
    let opponentIndex = remaining.findIndex(
      (candidate) =>
        candidate.wins === first.wins &&
        !previousPairings.has(pairingKey(first.teamId, candidate.teamId)),
    );

    if (opponentIndex < 0) {
      opponentIndex = remaining.findIndex(
        (candidate) =>
          !previousPairings.has(pairingKey(first.teamId, candidate.teamId)),
      );
    }

    if (opponentIndex < 0) {
      opponentIndex = 0;
    }

    const [opponent] = remaining.splice(opponentIndex, 1);
    slots.push({
      roundNumber,
      teamAId: first.teamId,
      teamBId: opponent.teamId,
    });
  }

  return slots;
}

export function pairingKey(firstTeamId: number, secondTeamId: number): string {
  return [firstTeamId, secondTeamId]
    .sort((left, right) => left - right)
    .join(':');
}

export function deriveLeagueFixtureSeed(
  careerId: number,
  year: number,
  splitNumber: number,
  fixtureNumber: number,
): number {
  return (
    (Math.imul(careerId, 73_856_093) ^
      Math.imul(year, 19_349_663) ^
      Math.imul(splitNumber, 83_492_791) ^
      Math.imul(fixtureNumber, 2_654_435_761)) >>>
    0
  );
}
