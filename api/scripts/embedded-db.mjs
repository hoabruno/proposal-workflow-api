// Local PostgreSQL without Docker: a real Postgres 18 cluster run from node_modules.
// Used by `npm run db:dev` and by the e2e test setup. Production uses a Postgres container.
import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const USER = 'atipik';
const PASSWORD = 'atipik';

/**
 * Starts a cluster in `dir` (initialised on first use), ensures `database`
 * exists and returns its connection URL plus a stop function.
 */
export async function startEmbeddedDb({
  dir,
  port,
  database,
  persistent = true,
}) {
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: USER,
    password: PASSWORD,
    port,
    persistent,
    onLog: () => {},
  });
  if (!existsSync(`${dir}/PG_VERSION`)) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(database);
  } catch (error) {
    // 42P04: database already exists, expected on every run after the first.
    if (error?.code !== '42P04') throw error;
  }
  return {
    url: `postgresql://${USER}:${PASSWORD}@localhost:${port}/${database}`,
    stop: () => pg.stop(),
  };
}

// `node scripts/embedded-db.mjs` keeps a development database running until Ctrl+C.
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await startEmbeddedDb({
    dir: './.pgdata/dev',
    port: 54329,
    database: 'atipik',
  });
  console.log(`Postgres ready: ${db.url}`);
  const shutdown = async () => {
    await db.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
