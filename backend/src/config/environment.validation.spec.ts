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

  it('keeps Google login disabled until a client ID is supplied', () => {
    expect(validateEnvironment(validConfig).GOOGLE_CLIENT_ID).toBe('');
    expect(validateEnvironment(validConfig).GOOGLE_ALLOWED_ORIGIN).toBe(
      'http://localhost:5173',
    );
  });

  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://[::1]:5173',
    'https://game.example.com/',
  ])('accepts an exact secure or local Google origin: %s', (origin) => {
    const config = validateEnvironment({
      ...validConfig,
      GOOGLE_CLIENT_ID: ' 123-test.apps.googleusercontent.com ',
      GOOGLE_ALLOWED_ORIGIN: origin,
    });
    expect(config.GOOGLE_CLIENT_ID).toBe('123-test.apps.googleusercontent.com');
    expect(config.GOOGLE_ALLOWED_ORIGIN).toBe(new URL(origin).origin);
  });

  it.each([
    'http://game.example.com',
    'https://game.example.com/callback',
    'https://game.example.com?x=1',
    'https://game.example.com#x',
    'https://user:pass@game.example.com',
    'javascript:alert(1)',
    '*',
    'null',
    '',
  ])('rejects an unsafe Google origin: %s', (origin) => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        GOOGLE_CLIENT_ID: '123-test.apps.googleusercontent.com',
        GOOGLE_ALLOWED_ORIGIN: origin,
      }),
    ).toThrow('Invalid environment configuration');
  });

  it.each([
    'secret-not-a-client-id',
    '123.apps.googleusercontent.com.attacker.test',
    'https://123.apps.googleusercontent.com',
  ])('rejects invalid Google client configuration: %s', (clientId) => {
    expect(() =>
      validateEnvironment({ ...validConfig, GOOGLE_CLIENT_ID: clientId }),
    ).toThrow('Invalid environment configuration');
  });
});
