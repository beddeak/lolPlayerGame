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
    PORT: '3000',
  };

  it('validates and transforms database configuration', () => {
    const result = validateEnvironment(validConfig);

    expect(result.DB_PORT).toBe(3306);
    expect(result.DB_SSL).toBe('false');
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
