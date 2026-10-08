import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getSchedule } from "@/lib/schedule";

const globalDb = globalThis as typeof globalThis & { commandPool?: Pool; commandDbReady?: Promise<void> };

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (use the Neon pooled PostgreSQL URL).");
  if (!globalDb.commandPool) {
    globalDb.commandPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  }
  return globalDb.commandPool;
}

export async function ready() {
  if (!globalDb.commandDbReady) {
    globalDb.commandDbReady = (async () => {
      const pool = db();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schedule_blocks (id TEXT PRIMARY KEY, plan_day TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, prayer TEXT);
        CREATE TABLE IF NOT EXISTS block_logs (block_id TEXT PRIMARY KEY, plan_day TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('done','missed')), reason TEXT, updated_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS nightly_reviews (plan_day TEXT PRIMARY KEY, answers_json TEXT NOT NULL, safety_count INTEGER NOT NULL DEFAULT 0 CHECK(safety_count BETWEEN 0 AND 2), draft_updated_at TEXT NOT NULL, submitted_at TEXT, late_entry INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS daily_scores (plan_day TEXT PRIMARY KEY, scores_json TEXT NOT NULL, created_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS backup_snapshots (plan_day TEXT PRIMARY KEY, created_at TEXT NOT NULL, data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (ip_key TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_started TIMESTAMPTZ NOT NULL, blocked_until TIMESTAMPTZ);
        INSERT INTO settings (key,value) VALUES ('late_entry_enabled','false') ON CONFLICT(key) DO NOTHING;
      `);
      await pool.query(`ALTER TABLE schedule_blocks ENABLE ROW LEVEL SECURITY;
        ALTER TABLE block_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
        ALTER TABLE nightly_reviews ENABLE ROW LEVEL SECURITY;
        ALTER TABLE daily_scores ENABLE ROW LEVEL SECURITY;
        ALTER TABLE backup_snapshots ENABLE ROW LEVEL SECURITY;
        ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
      `);
      const blocks = [];
      for (let n = 0; n < 15; n++) {
        const day = new Date(Date.UTC(2026, 9, 7 + n)).toISOString().slice(0, 10);
        blocks.push(...getSchedule(day).map(block => ({ ...block, day })));
      }
      await pool.query(`INSERT INTO schedule_blocks (id,plan_day,start_time,end_time,name,category,prayer)
        SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
        ON CONFLICT(id) DO NOTHING`, [blocks.map(b=>b.id), blocks.map(b=>b.day), blocks.map(b=>b.start), blocks.map(b=>b.end), blocks.map(b=>b.name), blocks.map(b=>b.category), blocks.map(b=>b.prayer ?? null)]);
    })().catch(error => { globalDb.commandDbReady = undefined; throw error; });
  }
  return globalDb.commandDbReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
  await ready();
  return db().query<T>(sql, values);
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  await ready();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
