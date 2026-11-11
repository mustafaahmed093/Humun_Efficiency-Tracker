import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { getSchedule, planEnd, planStart } from "@/lib/schedule";
import { tryWriteDailyBackup } from "@/lib/backup";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type ImportData = {
  formatVersion?: number;
  scheduleLog?: { plan_day: string; block_id: string; status: string; reason?: string; updated_at?: string }[];
  reviews?: { plan_day: string; answers?: Record<string, unknown>; safety_count?: number; draft_updated_at?: string; submitted_at?: string | null; late_entry?: boolean }[];
  dailyScores?: { plan_day: string; business?: number; health?: number; mental?: number; focus?: number; religious?: number; overall?: number; created_at?: string }[];
  lifeSystem?: Record<string, unknown>;
};
type ImportRow = Record<string, unknown>;
function validDay(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= planStart && day <= planEnd; }
function field(row: ImportRow, key: string, fallback: unknown = null) { return row[key] === undefined ? fallback : row[key]; }
function jsonField(row: ImportRow, key: string) { return typeof row[key] === "string" ? row[key] : JSON.stringify(row[key] ?? {}); }

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as ImportData | null;
  if (!body || ![1, 2].includes(Number(body.formatVersion)) || !Array.isArray(body.scheduleLog) || !Array.isArray(body.reviews) || !Array.isArray(body.dailyScores) ||
      (body.formatVersion === 2 && (!body.lifeSystem || typeof body.lifeSystem !== "object"))) {
    return NextResponse.json({ error: "Ye Command Center JSON export nahi lagti." }, { status: 400 });
  }
  const { scheduleLog, reviews, dailyScores } = body;
  const life = body.lifeSystem ?? {};
  const rows = (key: string) => Array.isArray(life[key]) ? (life[key] as unknown[]).filter((value): value is ImportRow => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
  try {
    const imported = await transaction(async client => {
    const saveLog = `INSERT INTO block_logs (block_id,plan_day,status,reason,updated_at,is_demo) VALUES ($1,$2,$3,$4,$5,0)
      ON CONFLICT(block_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,updated_at=excluded.updated_at,is_demo=0`;
    let logCount = 0;
    for (const log of scheduleLog) {
      if (!log || !validDay(log.plan_day) || !["done", "missed"].includes(log.status)) continue;
      if (log.status === "missed" && !log.reason?.trim()) continue;
      if (!getSchedule(log.plan_day).some(block => block.id === log.block_id)) continue;
      await client.query(saveLog, [log.block_id, log.plan_day, log.status, log.status === "missed" ? log.reason!.trim() : null, log.updated_at || new Date().toISOString()]);
      logCount++;
    }
    const saveReview = `INSERT INTO nightly_reviews (plan_day,answers_json,safety_count,draft_updated_at,submitted_at,late_entry,is_demo)
      VALUES ($1,$2,$3,$4,$5,$6,0) ON CONFLICT(plan_day) DO UPDATE SET answers_json=excluded.answers_json,safety_count=excluded.safety_count,draft_updated_at=excluded.draft_updated_at,submitted_at=excluded.submitted_at,late_entry=excluded.late_entry,is_demo=0`;
    let reviewCount = 0;
    for (const review of reviews) {
      if (!review || !validDay(review.plan_day) || !review.answers || typeof review.answers !== "object") continue;
      const answers = { ...review.answers }; delete answers.safetyCheck;
      const safety = Number(review.safety_count ?? 0);
      await client.query(saveReview, [review.plan_day, JSON.stringify(answers), Math.max(0, Math.min(2, Math.round(safety))), review.draft_updated_at || new Date().toISOString(), review.submitted_at ?? null, review.late_entry ? 1 : 0]);
      reviewCount++;
    }
    const scoreKeys = ["business", "health", "mental", "focus", "religious", "overall"] as const;
    const saveScore = "INSERT INTO daily_scores (plan_day,scores_json,created_at,is_demo) VALUES ($1,$2,$3,0) ON CONFLICT(plan_day) DO UPDATE SET scores_json=excluded.scores_json,created_at=excluded.created_at,is_demo=0";
    let scoreCount = 0;
    for (const row of dailyScores) {
      if (!row || !validDay(row.plan_day) || scoreKeys.some(key => typeof row[key] !== "number")) continue;
      await client.query(saveScore, [row.plan_day, JSON.stringify(Object.fromEntries(scoreKeys.map(key => [key, row[key]]))), row.created_at || new Date().toISOString()]);
      scoreCount++;
    }
    const goals = rows("goals");
    for (const row of goals) await client.query(`INSERT INTO goals
      (id,title,category,priority,goal_type,status,start_date,target_date,target_value,target_unit,current_value,is_primary,archived_at,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,priority=excluded.priority,goal_type=excluded.goal_type,status=excluded.status,start_date=excluded.start_date,target_date=excluded.target_date,target_value=excluded.target_value,target_unit=excluded.target_unit,current_value=excluded.current_value,is_primary=excluded.is_primary,archived_at=excluded.archived_at,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [field(row,"id"),field(row,"title",""),field(row,"category","Other"),field(row,"priority","medium"),field(row,"goal_type","one_time"),field(row,"status","active"),field(row,"start_date",new Date().toISOString().slice(0,10)),field(row,"target_date"),field(row,"target_value"),field(row,"target_unit"),Number(field(row,"current_value",0)),field(row,"is_primary") ? 1 : 0,field(row,"archived_at"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("milestones")) await client.query(`INSERT INTO goal_milestones
      (id,goal_id,title,description,due_date,target_value,status,position,completed_at,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO NOTHING`,
    [field(row,"id"),field(row,"goal_id"),field(row,"title",""),field(row,"description"),field(row,"due_date"),field(row,"target_value"),field(row,"status","pending"),Number(field(row,"position",0)),field(row,"completed_at"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("goalCheckins")) await client.query(`INSERT INTO goal_checkins
      (id,goal_id,checkin_date,worked,hours,output_value,target_met,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(goal_id,checkin_date) DO UPDATE SET worked=excluded.worked,hours=excluded.hours,output_value=excluded.output_value,target_met=excluded.target_met,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [field(row,"id"),field(row,"goal_id"),field(row,"checkin_date"),field(row,"worked",0),Number(field(row,"hours",0)),field(row,"output_value"),field(row,"target_met"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("goalCheckinHistory")) await client.query("INSERT INTO goal_checkin_history (id,checkin_id,previous_json,changed_at) VALUES ($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", [field(row,"id"),field(row,"checkin_id"),jsonField(row,"previous_json"),field(row,"changed_at",new Date().toISOString())]);
    for (const row of rows("weeklyReviews")) await client.query(`INSERT INTO goal_weekly_reviews (id,goal_id,week_start,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(goal_id,week_start) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [field(row,"id"),field(row,"goal_id"),field(row,"week_start"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("deadlineHistory")) await client.query("INSERT INTO goal_deadline_history (id,goal_id,previous_deadline,next_deadline,changed_at,reason) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING", [field(row,"id"),field(row,"goal_id"),field(row,"previous_deadline"),field(row,"next_deadline"),field(row,"changed_at",new Date().toISOString()),field(row,"reason")]);
    for (const row of rows("dependencies")) await client.query("INSERT INTO goal_dependencies (goal_id,depends_on_goal_id,created_at) VALUES ($1,$2,$3) ON CONFLICT(goal_id,depends_on_goal_id) DO NOTHING", [field(row,"goal_id"),field(row,"depends_on_goal_id"),field(row,"created_at",new Date().toISOString())]);
    const rules = rows("notToDoRules");
    for (const row of rules) await client.query(`INSERT INTO not_to_do_rules (id,title,category,start_date,active,archived_at,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,active=excluded.active,archived_at=excluded.archived_at,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [field(row,"id"),field(row,"title",""),field(row,"category","Other"),field(row,"start_date",new Date().toISOString().slice(0,10)),field(row,"active",1) ? 1 : 0,field(row,"archived_at"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("habitCheckins")) await client.query(`INSERT INTO not_to_do_checkins (id,rule_id,checkin_date,outcome,urges,intensity,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(rule_id,checkin_date) DO UPDATE SET outcome=excluded.outcome,urges=excluded.urges,intensity=excluded.intensity,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [field(row,"id"),field(row,"rule_id"),field(row,"checkin_date"),field(row,"outcome","not_applicable"),Number(field(row,"urges",0)),field(row,"intensity"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("habitCheckinHistory")) await client.query("INSERT INTO not_to_do_checkin_history (id,checkin_id,previous_json,changed_at) VALUES ($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", [field(row,"id"),field(row,"checkin_id"),jsonField(row,"previous_json"),field(row,"changed_at",new Date().toISOString())]);
    for (const row of rows("dailyPlans")) await client.query(`INSERT INTO daily_plans (plan_date,source,data_json,created_at,updated_at) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(plan_date) DO UPDATE SET source=excluded.source,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [field(row,"plan_date"),field(row,"source","custom"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("templates")) await client.query(`INSERT INTO daily_templates (id,title,description,data_json,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [field(row,"id"),field(row,"title",""),field(row,"description"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("activities")) await client.query(`INSERT INTO daily_activities
      (id,plan_date,title,start_time,end_time,category,priority,goal_id,milestone_id,status,actual_start,actual_end,actual_duration,data_json,position,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,start_time=excluded.start_time,end_time=excluded.end_time,category=excluded.category,priority=excluded.priority,goal_id=excluded.goal_id,milestone_id=excluded.milestone_id,status=excluded.status,actual_start=excluded.actual_start,actual_end=excluded.actual_end,actual_duration=excluded.actual_duration,data_json=excluded.data_json,position=excluded.position,updated_at=excluded.updated_at`,
    [field(row,"id"),field(row,"plan_date"),field(row,"title",""),field(row,"start_time"),field(row,"end_time"),field(row,"category","Other"),field(row,"priority","medium"),field(row,"goal_id"),field(row,"milestone_id"),field(row,"status","planned"),field(row,"actual_start"),field(row,"actual_end"),field(row,"actual_duration"),jsonField(row,"data_json"),Number(field(row,"position",0)),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    for (const row of rows("templateActivities")) await client.query(`INSERT INTO daily_template_activities (id,template_id,title,start_time,end_time,category,priority,data_json,position)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
    [field(row,"id"),field(row,"template_id"),field(row,"title",""),field(row,"start_time"),field(row,"end_time"),field(row,"category","Other"),field(row,"priority","medium"),jsonField(row,"data_json"),Number(field(row,"position",0))]);
    for (const row of rows("reminders")) await client.query(`INSERT INTO daily_reminders (id,kind,reference_id,enabled,preferred_time,frequency,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,reference_id=excluded.reference_id,enabled=excluded.enabled,preferred_time=excluded.preferred_time,frequency=excluded.frequency,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [field(row,"id"),field(row,"kind","custom"),field(row,"reference_id"),field(row,"enabled",1) ? 1 : 0,field(row,"preferred_time"),field(row,"frequency","daily"),jsonField(row,"data_json"),field(row,"created_at",new Date().toISOString()),field(row,"updated_at",new Date().toISOString())]);
    return { blocks: logCount, reviews: reviewCount, scores: scoreCount, lifeSystem: goals.length + rows("activities").length + rules.length + rows("goalCheckins").length + rows("habitCheckins").length };
    });
    await tryWriteDailyBackup();
    return NextResponse.json({ ok: true, imported });
  } catch {
    return NextResponse.json({ error: "Import nahi ho saka; database unchanged hai." }, { status: 500 });
  }
}
