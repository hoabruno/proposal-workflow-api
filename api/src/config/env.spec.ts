import { validateEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://localhost/x' };

describe('validateEnv', () => {
  it('requires a long, non-example JWT secret', () => {
    expect(() => validateEnv(base)).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/32/);
    expect(() =>
      validateEnv({
        ...base,
        JWT_SECRET: 'change-me-to-at-least-32-random-characters',
      }),
    ).toThrow(/example/);
    expect(validateEnv({ ...base, JWT_SECRET: 'a'.repeat(64) })).toMatchObject(
      base,
    );
  });
});
