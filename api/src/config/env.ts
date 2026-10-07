/** Fails fast at boot when required environment variables are missing. */
export function validateEnv(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const missing = ['DATABASE_URL'].filter(
    (key) => typeof env[key] !== 'string' || env[key] === '',
  );
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  return env;
}
