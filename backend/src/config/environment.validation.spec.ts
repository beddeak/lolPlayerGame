import 'reflect-metadata';
import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  const validConfig = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USERNAME: 'lol_manager_app',
    DB_PASSWORD: 'local-password',
    DB_DATABASE: 'lol_manager',
    DB_SSL: 'FALSE',
    JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
    JWT_EXPIRES_IN_SECONDS: '3600',
    PORT: '3000',
  };

  it('validates and transforms database configuration', () => {
    const result = validateEnvironment(validConfig);

    expect(result.DB_PORT).toBe(3306);
    expect(result.DB_SSL).toBe('false');
    expect(result.JWT_EXPIRES_IN_SECONDS).toBe(3600);
    expect(result.PORT).toBe(3000);
    expect(result.CATALOG_ADMIN_ACCOUNT_IDS).toEqual([]);
  });

  it('parses explicitly configured catalog admins, with empty denying everyone', () => {
    expect(
      validateEnvironment({
        ...validConfig,
        CATALOG_ADMIN_ACCOUNT_IDS: ' 7, 12 ',
      }).CATALOG_ADMIN_ACCOUNT_IDS,
    ).toEqual([7, 12]);
    expect(
      validateEnvironment({ ...validConfig, CATALOG_ADMIN_ACCOUNT_IDS: '' })
        .CATALOG_ADMIN_ACCOUNT_IDS,
    ).toEqual([]);
  });

  it.each(['0', '-1', '1.5', '1e2', '*', '7,,8', '7,7', '4294967296'])(
    'rejects invalid catalog admin IDs: %s',
    (ids) => {
      expect(() =>
        validateEnvironment({ ...validConfig, CATALOG_ADMIN_ACCOUNT_IDS: ids }),
      ).toThrow('Invalid environment configuration');
    },
  );

  it('rejects invalid database configuration', () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        DB_PORT: 'not-a-port',
        DB_SSL: 'sometimes',
      }),
    ).toThrow('Invalid environment configuration');
  });
});
