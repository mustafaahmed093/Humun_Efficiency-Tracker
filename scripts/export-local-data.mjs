import { DatabaseSync } from "node:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const input = resolve(process.argv[2] ?? "data/command-center.sqlite");
const output = resolve(process.argv[3] ?? "data/command-center-migration.json");
if (!existsSync(input)) {
  console.error(`SQLite database not found: ${input}`);
  process.exit(1);
}

const database = new DatabaseSync(input, { readOnly: true });
try {
  const scheduleLog = database.prepare("SELECT plan_day,block_id,status,reason,updated_at FROM block_logs WHERE is_demo=0 ORDER BY plan_day,updated_at").all();
  const reviews = database.prepare("SELECT plan_day,answers_json,safety_count,draft_updated_at,submitted_at,late_entry FROM nightly_reviews WHERE is_demo=0 ORDER BY plan_day").all().map(row => ({
    plan_day: row.plan_day,
    answers: JSON.parse(row.answers_json),
    safety_count: row.safety_count,
    draft_updated_at: row.draft_updated_at,
    submitted_at: row.submitted_at,
    late_entry: Boolean(row.late_entry),
  }));
  const dailyScores = database.prepare("SELECT plan_day,scores_json,created_at FROM daily_scores WHERE is_demo=0 ORDER BY plan_day").all().map(row => ({
    plan_day: row.plan_day,
    ...JSON.parse(row.scores_json),
    created_at: row.created_at,
  }));
  writeFileSync(output, `${JSON.stringify({ formatVersion: 1, scheduleLog, reviews, dailyScores }, null, 2)}\n`, { flag: "wx" });
  console.log(`Exported ${scheduleLog.length} check-ins, ${reviews.length} reviews, and ${dailyScores.length} score rows to ${output}`);
} finally {
  database.close();
}
