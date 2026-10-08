import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { startEmbeddedDb } from '../scripts/embedded-db.mjs';

const TEST_DIR = './.pgdata/test';

/** Starts a throwaway Postgres for the e2e suite and applies the real migrations. */
export default async function setup(): Promise<() => Promise<void>> {
  rmSync(TEST_DIR, { recursive: true, force: true });
  const db = await startEmbeddedDb({
    dir: TEST_DIR,
    port: 54330,
    database: 'atipik_test',
    persistent: false,
  });
  process.env.DATABASE_URL = db.url;
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-validation';
  process.env.COOKIE_SECURE = 'false';
  process.env.ALLOWED_ORIGINS = 'https://atipik.test';
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: db.url },
    stdio: 'ignore',
  });
  return async () => {
    await db.stop();
    rmSync(TEST_DIR, { recursive: true, force: true });
  };
}
