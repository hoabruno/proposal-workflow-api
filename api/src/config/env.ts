/** Fails fast at boot when required environment variables are missing. */
export function validateEnv(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const missing = ['DATABASE_URL', 'JWT_SECRET'].filter(
    (key) => typeof env[key] !== 'string' || env[key] === '',
  );
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  if (String(env.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return env;
}
