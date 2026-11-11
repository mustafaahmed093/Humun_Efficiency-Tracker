import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { Pool, type QueryResultRow } from "pg";
import { getPlanDays, getSchedule } from "@/lib/schedule";

type DbResult<T extends QueryResultRow> = { rows: T[]; rowCount: number | null };
type DbClient = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<DbResult<T>>;
};
type GlobalDb = typeof globalThis & {
  commandPool?: Pool;
  commandSqlite?: DatabaseSync;
  commandDbReady?: Promise<void>;
  commandSqliteQueue?: Promise<void>;
};

const globalDb = globalThis as GlobalDb;

const v2Schema = `
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL,
    goal_type TEXT NOT NULL, status TEXT NOT NULL, start_date TEXT NOT NULL, target_date TEXT,
    target_value REAL, target_unit TEXT, current_value REAL NOT NULL DEFAULT 0,
    is_primary INTEGER NOT NULL DEFAULT 0, archived_at TEXT, data_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS goal_milestones (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT, due_date TEXT, target_value REAL,
    status TEXT NOT NULL DEFAULT 'pending', position INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS goal_checkins (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    checkin_date TEXT NOT NULL, worked INTEGER NOT NULL, hours REAL NOT NULL DEFAULT 0,
    output_value REAL, target_met INTEGER, data_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(goal_id, checkin_date)
  );
  CREATE TABLE IF NOT EXISTS goal_checkin_history (
    id TEXT PRIMARY KEY, checkin_id TEXT NOT NULL REFERENCES goal_checkins(id) ON DELETE CASCADE,
    previous_json TEXT NOT NULL, changed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS goal_weekly_reviews (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, UNIQUE(goal_id, week_start)
  );
  CREATE TABLE IF NOT EXISTS goal_deadline_history (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    previous_deadline TEXT, next_deadline TEXT, changed_at TEXT NOT NULL, reason TEXT
  );
  CREATE TABLE IF NOT EXISTS goal_dependencies (
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    depends_on_goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, PRIMARY KEY(goal_id, depends_on_goal_id),
    CHECK(goal_id <> depends_on_goal_id)
  );
  CREATE TABLE IF NOT EXISTS not_to_do_rules (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
    start_date TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS not_to_do_checkins (
    id TEXT PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES not_to_do_rules(id) ON DELETE CASCADE,
    checkin_date TEXT NOT NULL, outcome TEXT NOT NULL, urges INTEGER NOT NULL DEFAULT 0,
    intensity INTEGER, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, UNIQUE(rule_id, checkin_date)
  );
  CREATE TABLE IF NOT EXISTS not_to_do_checkin_history (
    id TEXT PRIMARY KEY, checkin_id TEXT NOT NULL REFERENCES not_to_do_checkins(id) ON DELETE CASCADE,
    previous_json TEXT NOT NULL, changed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_plans (
    plan_date TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'custom',
    data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_activities (
    id TEXT PRIMARY KEY, plan_date TEXT NOT NULL, title TEXT NOT NULL,
    start_time TEXT, end_time TEXT, category TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium',
    goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
    milestone_id TEXT REFERENCES goal_milestones(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'planned', actual_start TEXT, actual_end TEXT,
    actual_duration REAL, data_json TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_templates (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_template_activities (
    id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES daily_templates(id) ON DELETE CASCADE,
    title TEXT NOT NULL, start_time TEXT, end_time TEXT, category TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium', data_json TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS daily_reminders (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, reference_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, preferred_time TEXT,
    frequency TEXT NOT NULL DEFAULT 'daily', data_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS goals_status_deadline_idx ON goals(status, target_date);
  CREATE INDEX IF NOT EXISTS goal_checkins_date_idx ON goal_checkins(checkin_date);
  CREATE INDEX IF NOT EXISTS not_to_do_checkins_date_idx ON not_to_do_checkins(checkin_date);
  CREATE INDEX IF NOT EXISTS daily_activities_date_idx ON daily_activities(plan_date, position);
`;

function localSqlitePath() {
  return process.env.LOCAL_SQLITE_PATH;
}

function sqliteDb() {
  const path = localSqlitePath();
  if (!path) throw new Error("LOCAL_SQLITE_PATH is required for local SQLite mode.");
  if (!globalDb.commandSqlite) globalDb.commandSqlite = new DatabaseSync(resolve(process.cwd(), "data", path));
  return globalDb.commandSqlite;
}

function postgresPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL mode.");
  if (!globalDb.commandPool) {
    globalDb.commandPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  }
  return globalDb.commandPool;
}

async function withSqliteLock<T>(work: () => T | Promise<T>): Promise<T> {
  const previous = globalDb.commandSqliteQueue ?? Promise.resolve();
  let release!: () => void;
  globalDb.commandSqliteQueue = new Promise<void>(resolveQueue => { release = resolveQueue; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function sqliteQuery<T extends QueryResultRow>(sql: string, values: unknown[] = []): DbResult<T> {
  const database = sqliteDb();
  if (!values.length && sql.includes(";")) {
    database.exec(sql);
    return { rows: [], rowCount: null };
  }
  const statement = database.prepare(sql.replace(/\$(\d+)/g, "?$1"));
  if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) {
    return { rows: statement.all<T>(...values), rowCount: null };
  }
  const result = statement.run(...values);
  return { rows: [], rowCount: result.changes };
}

function initializeSqlite() {
  const database = sqliteDb();
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schedule_blocks (id TEXT PRIMARY KEY, plan_day TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, prayer TEXT);
    CREATE TABLE IF NOT EXISTS block_logs (block_id TEXT PRIMARY KEY, plan_day TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('done','missed')), reason TEXT, updated_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nightly_reviews (plan_day TEXT PRIMARY KEY, answers_json TEXT NOT NULL, safety_count INTEGER NOT NULL DEFAULT 0 CHECK(safety_count BETWEEN 0 AND 2), draft_updated_at TEXT NOT NULL, submitted_at TEXT, late_entry INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS daily_scores (plan_day TEXT PRIMARY KEY, scores_json TEXT NOT NULL, created_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS backup_snapshots (plan_day TEXT PRIMARY KEY, created_at TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts (ip_key TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_started TEXT NOT NULL, blocked_until TEXT);
    INSERT INTO settings (key,value) VALUES ('late_entry_enabled','false') ON CONFLICT(key) DO NOTHING;
  `);
  database.exec(v2Schema);
  const insertBlock = database.prepare(`INSERT INTO schedule_blocks (id,plan_day,start_time,end_time,name,category,prayer)
    VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO NOTHING`);
  for (const day of getPlanDays()) {
    for (const block of getSchedule(day)) {
      insertBlock.run(block.id, day, block.start, block.end, block.name, block.category, block.prayer ?? null);
    }
  }
}

export async function ready() {
  if (!globalDb.commandDbReady) {
    globalDb.commandDbReady = (async () => {
      if (localSqlitePath()) {
        initializeSqlite();
        return;
      }
      const pool = postgresPool();
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
      await pool.query(v2Schema);
      await pool.query(`ALTER TABLE schedule_blocks ENABLE ROW LEVEL SECURITY;
        ALTER TABLE block_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
        ALTER TABLE nightly_reviews ENABLE ROW LEVEL SECURITY;
        ALTER TABLE daily_scores ENABLE ROW LEVEL SECURITY;
        ALTER TABLE backup_snapshots ENABLE ROW LEVEL SECURITY;
        ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
      `);
      const blocks = [];
      for (const day of getPlanDays()) {
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
  if (localSqlitePath()) return withSqliteLock(() => sqliteQuery<T>(sql, values));
  return postgresPool().query<T>(sql, values);
}

export async function transaction<T>(work: (client: DbClient) => Promise<T>) {
  await ready();
  if (localSqlitePath()) {
    return withSqliteLock(async () => {
      const database = sqliteDb();
      const client: DbClient = {
        query: async <R extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) => sqliteQuery<R>(sql, values),
      };
      database.exec("BEGIN");
      try {
        const result = await work(client);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    });
  }
  const client = await postgresPool().connect();
  const dbClient: DbClient = {
    query: async <R extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) => client.query<R>(sql, values),
  };
  try {
    await client.query("BEGIN");
    const result = await work(dbClient);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
