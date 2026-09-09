import { BadRequestException } from '@nestjs/common';
import { PlayerPersonality } from '../players/enums/player-personality.enum';
import { Position } from '../players/enums/position.enum';
import {
  ContractEvaluationContext,
  evaluateContractOffer,
  getResponseDelayDays,
  validateContractTerms,
} from './contract-policy';
import {
  ContractExpectedRole,
  ContractPromiseType,
  ContractTerms,
} from './contract.types';

describe('contract policy', () => {
  const terms: ContractTerms = {
    annualSalary: 200_000,
    years: 2,
    starterGuarantee: true,
    expectedRole: ContractExpectedRole.STARTER,
    promises: [],
  };
  const context: ContractEvaluationContext = {
    ability: 80,
    teamStrength: 80,
    coachTrust: 50,
    personality: PlayerPersonality.PROFESSIONAL,
    currentAnnualSalary: null,
  };

  it('produces a stable response delay between one and three days', () => {
    const delays = new Set<number>();
    for (let id = 1; id <= 30; id++) {
      for (let revision = 1; revision <= 5; revision++) {
        const delay = getResponseDelayDays(id, revision);
        expect(delay).toBeGreaterThanOrEqual(1);
        expect(delay).toBeLessThanOrEqual(3);
        expect(getResponseDelayDays(id, revision)).toBe(delay);
        delays.add(delay);
      }
    }
    expect([...delays].sort()).toEqual([1, 2, 3]);
  });

  it('accepts suitable terms and does not mutate inputs', () => {
    const input = structuredClone(terms);
    expect(evaluateContractOffer(input, context).kind).toBe('ACCEPTED');
    expect(input).toEqual(terms);
  });

  it('returns a salary counteroffer that can subsequently be accepted', () => {
    const input = { ...terms, annualSalary: 1 };
    const response = evaluateContractOffer(input, context);
    expect(response.kind).toBe('COUNTER_OFFER');
    expect(response.counterTerms!.annualSalary).toBeGreaterThan(1);
    expect(evaluateContractOffer(response.counterTerms!, context).kind).toBe(
      'ACCEPTED',
    );
    expect(input.annualSalary).toBe(1);
  });

  it('does not let a maximum salary override broken coach trust', () => {
    const response = evaluateContractOffer(
      { ...terms, annualSalary: 10_000_000 },
      { ...context, coachTrust: 0 },
    );
    expect(response.kind).toBe('REJECTED');
    expect(response.counterTerms).toBeNull();
  });

  it('demands a core role and starter guarantee regardless of money for a self-centered player', () => {
    const response = evaluateContractOffer(
      {
        ...terms,
        annualSalary: 10_000_000,
        expectedRole: ContractExpectedRole.PROSPECT,
        starterGuarantee: false,
      },
      { ...context, personality: PlayerPersonality.SELF_CENTERED },
    );
    expect(response.kind).toBe('COUNTER_OFFER');
    expect(response.counterTerms).toMatchObject({
      expectedRole: ContractExpectedRole.CORE,
      starterGuarantee: true,
    });
  });

  it('asks for a team improvement plan when a star greatly exceeds team strength', () => {
    const response = evaluateContractOffer(terms, {
      ...context,
      ability: 95,
      teamStrength: 65,
    });
    expect(response.kind).toBe('COUNTER_OFFER');
    expect(response.counterTerms!.promises).toContainEqual({
      type: ContractPromiseType.STRENGTHEN_TEAM,
    });
    expect(terms.promises).toEqual([]);
  });

  it('accounts for the existing salary when generating a counteroffer', () => {
    const response = evaluateContractOffer(terms, {
      ...context,
      currentAnnualSalary: 300_000,
    });
    expect(response.kind).toBe('COUNTER_OFFER');
    expect(response.counterTerms!.annualSalary).toBeGreaterThanOrEqual(300_000);
  });

  it('accounts for contract length in a salary request', () => {
    const short = evaluateContractOffer({ ...terms, annualSalary: 1 }, context);
    const long = evaluateContractOffer(
      { ...terms, annualSalary: 1, years: 5 },
      context,
    );
    expect(long.counterTerms!.annualSalary).toBeGreaterThan(
      short.counterTerms!.annualSalary,
    );
  });

  it.each([
    {
      ...terms,
      starterGuarantee: true,
      expectedRole: ContractExpectedRole.ROTATION,
    },
    { ...terms, promises: [{ type: ContractPromiseType.SIGN_POSITION }] },
    { ...terms, promises: [{ type: ContractPromiseType.CARRY_ROLE }] },
    {
      ...terms,
      starterGuarantee: false,
      promises: [{ type: ContractPromiseType.STARTER_GUARANTEE }],
    },
    {
      ...terms,
      promises: [
        { type: ContractPromiseType.STRENGTHEN_TEAM, position: Position.MID },
      ],
    },
    {
      ...terms,
      promises: [
        { type: ContractPromiseType.SIGN_POSITION, position: Position.MID },
        { type: ContractPromiseType.SIGN_POSITION, position: Position.MID },
      ],
    },
  ])('rejects contradictory or duplicate promises: %j', (input) => {
    expect(() => validateContractTerms(input)).toThrow(BadRequestException);
  });

  it('allows distinct positions and compatible starter/carry promises', () => {
    expect(() =>
      validateContractTerms({
        ...terms,
        expectedRole: ContractExpectedRole.CORE,
        promises: [
          { type: ContractPromiseType.STARTER_GUARANTEE },
          { type: ContractPromiseType.CARRY_ROLE },
          { type: ContractPromiseType.SIGN_POSITION, position: Position.MID },
          {
            type: ContractPromiseType.SIGN_POSITION,
            position: Position.SUPPORT,
          },
        ],
      }),
    ).not.toThrow();
  });
});
