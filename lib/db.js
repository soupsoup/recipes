const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// Every query goes through `query(text, params)`, which returns the result rows.
// Production uses Postgres (Supabase) through DATABASE_URL. Local runs and tests
// use PGlite, an in-process Postgres, so no database server is needed.
function openDb({ databaseUrl, dataDir } = {}) {
  if (databaseUrl) {
    const postgres = require('postgres');
    // prepare: false is required by Supabase's transaction pooler.
    const sql = postgres(databaseUrl, { prepare: false, max: 1, idle_timeout: 20 });
    return {
      query: (text, params = []) => sql.unsafe(text, params),
      close: () => sql.end(),
    };
  }

  let ready;
  const pglite = () => {
    ready ??= (async () => {
      const { PGlite } = await import('@electric-sql/pglite');
      if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
      const db = new PGlite(dataDir);
      await db.exec(SCHEMA);
      return db;
    })();
    return ready;
  };
  return {
    query: async (text, params = []) => (await (await pglite()).query(text, params)).rows,
    close: async () => ready && (await ready).close(),
  };
}

module.exports = { openDb };
