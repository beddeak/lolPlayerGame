import { DataSource, EntityManager } from 'typeorm';
import { STARTER_POSITIONS } from '../careers/constants/career.constants';
import { Career } from '../careers/entities/career.entity';
import { CareerPlayer } from '../careers/entities/career-player.entity';
import { CareerTeam } from '../careers/entities/career-team.entity';
import { Roster } from '../careers/entities/roster.entity';
import { RosterRole } from '../careers/enums/roster-role.enum';
import { PlayerContract } from '../contracts/entities/player-contract.entity';
import { PlayerContractStatus } from '../contracts/contract.types';
import { Position } from '../players/enums/position.enum';
import { TransferRecord } from './entities/transfer-record.entity';
import { TransfersService } from './transfers.service';

describe('Actual transfer lineup snapshots', () => {
  function setup(managed = true, replacement = true) {
    const career = { id: 1, accountId: 7, currentDate: '2026-11-20' };
    const team = {
      id: 3,
      careerId: 1,
      isUserControlled: managed,
    } as CareerTeam;
    const makePlayer = (
      id: number,
      ability: number,
      position: Position,
    ): CareerPlayer =>
      ({
        id,
        careerId: 1,
        currentTeamId: team.id,
        currentPosition: position,
        currentMechanics: ability,
        currentGameSense: ability,
        currentLaning: ability,
        currentTeamFight: ability,
        currentMacro: ability,
        currentTeamPlay: ability,
        currentMental: ability,
        currentChampionPool: ability,
      }) as CareerPlayer;
    let slots = STARTER_POSITIONS.map(
      (position, index) =>
        ({
          id: 11 + index,
          careerTeamId: team.id,
          careerPlayerId: 101 + index,
          role: RosterRole.STARTER,
          starterPosition: position,
          careerPlayer: makePlayer(101 + index, 80, position),
        }) as Roster,
    );
    const departing = slots[0];
    if (replacement)
      slots.push({
        id: 20,
        careerTeamId: team.id,
        careerPlayerId: 201,
        role: RosterRole.BENCH,
        starterPosition: null,
        careerPlayer: makePlayer(201, 60, Position.TOP),
      } as Roster);
    const savedRecords: TransferRecord[] = [];
    const manager = {
      findOne: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === Career
            ? career
            : entity === CareerPlayer
              ? departing.careerPlayer
              : entity === Roster
                ? departing
                : null,
        ),
      ),
      findOneBy: jest.fn().mockResolvedValue(team),
      find: jest.fn(
        (entity: unknown, options: { where?: { role?: RosterRole } }) =>
          Promise.resolve(
            entity === Roster
              ? slots.filter((slot) => slot.role === options.where?.role)
              : [],
          ),
      ),
      save: jest.fn((entity: unknown, value: unknown) => {
        if (entity === TransferRecord) {
          const record = value as TransferRecord;
          record.id = 77;
          savedRecords.push(record);
        }
        return Promise.resolve(value);
      }),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      delete: jest.fn((_entity: unknown, id: number) => {
        slots = slots.filter((slot) => slot.id !== id);
        return Promise.resolve({ affected: 1 });
      }),
    };
    const service = new TransfersService({
      transaction: (work: (value: EntityManager) => Promise<unknown>) =>
        work(manager as unknown as EntityManager),
    } as unknown as DataSource);
    const contract = {
      careerId: 1,
      careerTeamId: team.id,
      careerPlayerId: departing.careerPlayerId,
      status: PlayerContractStatus.ACTIVE,
    } as PlayerContract;
    return { service, manager, savedRecords, contract };
  }

  it('records the actual weaker replacement after releasing a starting player', async () => {
    const { service, savedRecords } = setup();
    await service.releasePlayer(7, 1, 101);
    expect(savedRecords).toHaveLength(1);
    expect(savedRecords[0]).toMatchObject({
      managerLineupBefore: 80,
      managerLineupAfter: 76,
    });
  });

  it('records a vacant slot when a managed starter contract expires', async () => {
    const { service, manager, savedRecords, contract } = setup(true, false);
    await service.expireContract(
      manager as unknown as EntityManager,
      contract,
      '2026-11-21',
    );
    expect(savedRecords[0]).toMatchObject({
      managerLineupBefore: 80,
      managerLineupAfter: 64,
    });
  });

  it('does not grade AI-only expiration as a manager transfer', async () => {
    const { service, manager, savedRecords, contract } = setup(false);
    await service.expireContract(
      manager as unknown as EntityManager,
      contract,
      '2026-11-21',
    );
    expect(savedRecords[0]).toMatchObject({
      managerLineupBefore: null,
      managerLineupAfter: null,
    });
  });
});
