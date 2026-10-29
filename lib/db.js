const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS solves (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  days JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  d INTEGER NOT NULL,
  p INTEGER NOT NULL,
  t TEXT NOT NULL,
  at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS solutions (
  day INTEGER PRIMARY KEY,
  data JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  name_key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0
);
`;

let runner;
let ready;

async function makeRunner() {
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    return {
      query: (text, params = []) => sql(text, params),
      exec: async (text) => { for (const stmt of text.split(";").map(s => s.trim()).filter(Boolean)) await sql(stmt, []); },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(process.env.PGLITE_DIR || undefined);
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows,
    exec: (text) => pg.exec(text),
  };
}

export async function db() {
  if (!ready) {
    ready = (async () => {
      runner = await makeRunner();
      await runner.exec(SCHEMA);
      return runner;
    })();
  }
  return ready;
}

export async function q(text, params) {
  const r = await db();
  return r.query(text, params);
}
