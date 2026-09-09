import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ContractDecisionAction,
  ContractExpectedRole,
  ContractPromiseType,
} from '../contract.types';
import { CreateContractOfferDto } from './create-contract-offer.dto';
import { RespondContractOfferDto } from './respond-contract-offer.dto';

describe('contract request DTOs', () => {
  const terms = {
    annualSalary: 100_000,
    years: 2,
    starterGuarantee: true,
    expectedRole: ContractExpectedRole.STARTER,
    promises: [],
  };
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('accepts a valid nested offer without implicitly coercing numbers', () => {
    const dto = plainToInstance(CreateContractOfferDto, {
      careerPlayerId: 1,
      terms,
    });
    expect(validateSync(dto, options)).toHaveLength(0);
    const invalid = plainToInstance(CreateContractOfferDto, {
      careerPlayerId: 1,
      terms: { ...terms, annualSalary: '100000' },
    });
    expect(validateSync(invalid, options)).not.toHaveLength(0);
  });

  it.each([
    { annualSalary: 0 },
    { annualSalary: 10_000_001 },
    { annualSalary: 100.5 },
    { years: 0 },
    { years: 6 },
    { years: 1.5 },
    { starterGuarantee: 'true' },
    { expectedRole: 'UNKNOWN' },
    { promises: null },
    { promises: [{ type: 'UNKNOWN' }] },
    { promises: [{ type: ContractPromiseType.SIGN_POSITION, position: null }] },
    {
      promises: [
        { type: ContractPromiseType.STRENGTHEN_TEAM, extra: 'ignored?' },
      ],
    },
  ])('rejects invalid nested fields %j', (overrides) => {
    const dto = plainToInstance(CreateContractOfferDto, {
      careerPlayerId: 1,
      terms: { ...terms, ...overrides },
    });
    expect(validateSync(dto, options)).not.toHaveLength(0);
  });

  it.each([undefined, null, [], 'terms'])(
    'requires object terms: %j',
    (value) => {
      const dto = plainToInstance(CreateContractOfferDto, {
        careerPlayerId: 1,
        terms: value,
      });
      expect(validateSync(dto, options)).not.toHaveLength(0);
    },
  );

  it('requires counter terms but permits decisions without new terms', () => {
    const counter = plainToInstance(RespondContractOfferDto, {
      action: ContractDecisionAction.COUNTER,
    });
    expect(validateSync(counter, options)).not.toHaveLength(0);
    const accept = plainToInstance(RespondContractOfferDto, {
      action: ContractDecisionAction.ACCEPT,
    });
    expect(validateSync(accept, options)).toHaveLength(0);
    const validCounter = plainToInstance(RespondContractOfferDto, {
      action: ContractDecisionAction.COUNTER,
      terms,
    });
    expect(validateSync(validCounter, options)).toHaveLength(0);
  });

  it('does not accept null terms as an omitted optional value', () => {
    const dto = plainToInstance(RespondContractOfferDto, {
      action: ContractDecisionAction.ACCEPT,
      terms: null,
    });
    expect(validateSync(dto, options)).not.toHaveLength(0);
  });
});
