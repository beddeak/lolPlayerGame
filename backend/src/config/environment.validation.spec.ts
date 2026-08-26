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
  });

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
