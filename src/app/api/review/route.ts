import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { getSchedule, planEnd, planStart } from "@/lib/schedule";
import { getReviewWindow } from "@/lib/review-time";
import { calculateScores, type DailyAnswers } from "@/lib/scoring";
import { effectiveServerNow } from "@/lib/server-time";
import { tryWriteDailyBackup } from "@/lib/backup";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const prayerNames = ["Fajr", "Zohr", "Asr", "Maghrib", "Isha"];
type AnswerRecord = DailyAnswers & Record<string, unknown>;
type ReviewRow = { plan_day: string; answers_json: string; safety_count: number; draft_updated_at: string; submitted_at: string | null; late_entry: number };
type BlockRow = { id: string; start: string; end: string; name: string; category: string; prayer: string | null; status: "done" | "missed" | null; reason: string | null };

function unlocked(request: NextRequest) { return isUnlocked(request); }
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
function validReviewDate(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === day;
}
async function currentWindow(now = effectiveServerNow()) {
  const lateEnabled = (await query<{ value: string }>("SELECT value FROM settings WHERE key='late_entry_enabled'")).rows[0]?.value === "true";
  return { ...getReviewWindow(now, lateEnabled), lateEntryEnabled: lateEnabled };
}

function elapsedPlanMinutes(now = effectiveServerNow()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find(part => part.type === "hour")?.value) * 60 + Number(parts.find(part => part.type === "minute")?.value) + 1440;
}

function isDue(block: { end: string }, minutes: number) {
  const [hours, mins] = block.end.split(":").map(Number);
  return hours * 60 + mins <= minutes;
}

async function rowsForDay(day: string): Promise<BlockRow[]> {
  if (day < planStart || day > planEnd) {
    const activities = (await query<{ id: string; start_time: string | null; end_time: string | null; title: string; category: string; status: string; data_json: string }>(
      "SELECT id,start_time,end_time,title,category,status,data_json FROM daily_activities WHERE plan_date=$1 ORDER BY position,start_time", [day])).rows;
    return activities.map(activity => {
      const data = JSON.parse(activity.data_json) as { prayer?: string | null; reason?: string | null };
      return {
        id: activity.id, start: activity.start_time ?? "00:00", end: activity.end_time ?? "00:00",
        name: activity.title, category: activity.category, prayer: data.prayer ?? null,
        status: activity.status === "completed" ? "done" : activity.status === "missed" ? "missed" : null,
        reason: data.reason ?? null,
      };
    });
  }
  const rows = (await query<BlockRow>(`SELECT s.id,s.start_time as start,s.end_time as end,s.name,s.category,s.prayer,l.status,l.reason
    FROM schedule_blocks s LEFT JOIN block_logs l ON l.block_id=s.id
    WHERE s.plan_day=$1 ORDER BY s.start_time`, [day])).rows;
  return rows.length ? rows : getSchedule(day).map(block => ({ ...block, prayer: block.prayer ?? null, status: null, reason: null }));
}

export async function GET(request: NextRequest) {
  if (!unlocked(request)) return error("Unlock the local app first.", 401);
  const window = await currentWindow();
  const day = request.nextUrl.searchParams.get("date") ?? window.targetDay;
  if (!validReviewDate(day) || day < "2000-01-01" || day > "2200-12-31" || day > window.targetDay) {
    return NextResponse.json({ window, day, inPlan: false, fixedPlan: false, blocks: [], review: null });
  }
  const row = (await query<ReviewRow>("SELECT plan_day,answers_json,safety_count,draft_updated_at,submitted_at,late_entry FROM nightly_reviews WHERE plan_day=$1", [day])).rows[0];
  const answers: AnswerRecord = row ? { ...JSON.parse(row.answers_json), safetyCheck: ["Nahi", "Halka", "Tez"][row.safety_count] } : {};
  const blocks = await rowsForDay(day);
  const pending = day >= planStart && day <= planEnd
    ? blocks.filter(block => block.category !== "Review" && isDue(block, elapsedPlanMinutes()) && !block.status).length
    : (await query<{ status: string; end_time: string | null }>("SELECT status,end_time FROM daily_activities WHERE plan_date=$1", [day])).rows
      .filter(activity => ["planned", "rescheduled"].includes(activity.status) && activity.end_time && isDue({ end: activity.end_time }, elapsedPlanMinutes())).length;
  const savedScores = (await query<{ scores_json: string }>("SELECT scores_json FROM daily_scores WHERE plan_day=$1", [day])).rows[0];
  const [goals, habits] = await Promise.all([
    query<{ id: string; title: string; target_unit: string | null; data_json: string }>("SELECT id,title,target_unit,data_json FROM goals WHERE archived_at IS NULL AND status NOT IN ('paused','completed','cancelled') ORDER BY is_primary DESC,updated_at DESC"),
    query<{ id: string; title: string }>("SELECT id,title FROM not_to_do_rules WHERE archived_at IS NULL AND active=1 ORDER BY created_at"),
  ]);
  const countable = blocks.filter(block => block.category !== "Review");
  const completion = countable.length ? Math.round(countable.filter(block => block.status === "done").length / countable.length * 100) : 0;
  return NextResponse.json({ window, day, inPlan: true, fixedPlan: day >= planStart && day <= planEnd, blocks, pending,
    goals: goals.rows.map(goal => ({ id: goal.id, title: goal.title, targetUnit: goal.target_unit, dailyTarget: (JSON.parse(goal.data_json) as Record<string, string>).dailyTarget ?? null })),
    habits: habits.rows,
    review: row ? { answers, submittedAt: row.submitted_at, lateEntry: Boolean(row.late_entry), draftUpdatedAt: row.draft_updated_at } : null,
    summary: row?.submitted_at && savedScores ? { scores: JSON.parse(savedScores.scores_json), completion } : null });
}

export async function POST(request: NextRequest) {
  if (!unlocked(request)) return error("Unlock the local app first.", 401);
  const window = await currentWindow();
  if (!window.open) return NextResponse.json({ error: "Raat ka Review abhi locked hai.", window }, { status: 423 });
  const body = await request.json().catch(() => null) as { action?: string; day?: string; answers?: AnswerRecord } | null;
  if (!body || !body.day || body.day !== window.targetDay || body.day < "2000-01-01" || body.day > "2200-12-31" ||
      !validReviewDate(body.day) || !body.answers || typeof body.answers !== "object") {
    return error("Review data valid nahi hai.", 400);
  }
  const existing = (await query<{ submitted_at: string | null }>("SELECT submitted_at FROM nightly_reviews WHERE plan_day=$1", [body.day])).rows[0];
  if (existing?.submitted_at) return error("Ye review pehle hi submit ho chuka hai.", 409);

  const answers = { ...body.answers };
  const safety = answers.safetyCheck;
  const safetyCount = safety === "Halka" ? 1 : safety === "Tez" ? 2 : 0;
  delete answers.safetyCheck;
  const timestamp = effectiveServerNow().toISOString();
  if (body.action === "draft") {
    await query(`INSERT INTO nightly_reviews (plan_day,answers_json,safety_count,draft_updated_at)
      VALUES ($1,$2,$3,$4) ON CONFLICT(plan_day) DO UPDATE SET answers_json=excluded.answers_json,safety_count=excluded.safety_count,draft_updated_at=excluded.draft_updated_at,is_demo=0 WHERE nightly_reviews.submitted_at IS NULL`, [body.day, JSON.stringify(answers), safetyCount, timestamp]);
    return NextResponse.json({ ok: true, savedAt: timestamp });
  }
  if (body.action !== "submit") return error("Unknown review action.", 400);

  const prayerAnswers = answers.prayers as Record<string, boolean | null> | undefined;
  const fixedPlan = body.day >= planStart && body.day <= planEnd;
  if (fixedPlan && (!prayerAnswers || prayerNames.some(name => typeof prayerAnswers[name] !== "boolean"))) {
    return error("Paanch namazon ka status select karo.", 400);
  }
  const dayBlocks = await rowsForDay(body.day);
  try {
    const result = await transaction(async client => {
    const prayerInsert = `INSERT INTO block_logs (block_id,plan_day,status,reason,updated_at) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(block_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,updated_at=excluded.updated_at,is_demo=0`;
    if (fixedPlan && prayerAnswers) {
      for (const block of dayBlocks) {
        if (block.prayer && typeof prayerAnswers[block.prayer] === "boolean") {
          const isDone = prayerAnswers[block.prayer];
          const reason = isDone ? null : block.status === "missed" && block.reason ? block.reason : "Marked not done in Raat ka Review";
          await client.query(prayerInsert, [block.id, body.day, isDone ? "done" : "missed", reason, timestamp]);
        }
      }
    }
    const pending = fixedPlan
      ? (await client.query<BlockRow>(`SELECT s.id,s.start_time as start,s.end_time as end,s.name,s.category,s.prayer,l.status,l.reason FROM schedule_blocks s LEFT JOIN block_logs l ON l.block_id=s.id WHERE s.plan_day=$1 ORDER BY s.start_time`, [body.day])).rows.filter(block => block.category !== "Review" && isDue(block, elapsedPlanMinutes()) && !block.status)
      : (await client.query<{ status: string; end_time: string | null }>("SELECT status,end_time FROM daily_activities WHERE plan_date=$1", [body.day])).rows
        .filter(activity => ["planned", "rescheduled"].includes(activity.status) && activity.end_time && isDue({ end: activity.end_time }, elapsedPlanMinutes()));
    if (pending.length) {
      throw new Error("PENDING:" + pending.length);
    }
    const goalCheckins = answers.goalCheckins && typeof answers.goalCheckins === "object" ? answers.goalCheckins as Record<string, unknown> : {};
    for (const [goalId, raw] of Object.entries(goalCheckins)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const checkin = raw as Record<string, unknown>;
      if (typeof checkin.worked !== "boolean") continue;
      const hours = checkin.hours === undefined || checkin.hours === "" ? 0 : Number(checkin.hours);
      const outputValue = checkin.outputValue === undefined || checkin.outputValue === "" || checkin.outputValue === null ? null : Number(checkin.outputValue);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24 || (outputValue !== null && (!Number.isFinite(outputValue) || outputValue < 0))) continue;
      const goal = (await client.query<{ current_value: number }>("SELECT current_value FROM goals WHERE id=$1 AND archived_at IS NULL AND status NOT IN ('paused','completed','cancelled')", [goalId])).rows[0];
      if (!goal) continue;
      const existingCheckin = (await client.query<{ id: string; worked: number; hours: number; output_value: number | null; target_met: number | null; data_json: string }>("SELECT id,worked,hours,output_value,target_met,data_json FROM goal_checkins WHERE goal_id=$1 AND checkin_date=$2", [goalId, body.day])).rows[0];
      if (existingCheckin) await client.query("INSERT INTO goal_checkin_history (id,checkin_id,previous_json,changed_at) VALUES ($1,$2,$3,$4)", [randomUUID(), existingCheckin.id, JSON.stringify(existingCheckin), timestamp]);
      if ((existingCheckin?.output_value ?? null) !== outputValue && (existingCheckin?.output_value !== null && existingCheckin?.output_value !== undefined || outputValue !== null)) {
        await client.query("UPDATE goals SET current_value=$1,updated_at=$2 WHERE id=$3", [Math.max(0, Number(goal.current_value) - Number(existingCheckin?.output_value ?? 0) + Number(outputValue ?? 0)), timestamp, goalId]);
      }
      const previousData = existingCheckin ? JSON.parse(existingCheckin.data_json) as Record<string, unknown> : {};
      const plannerHours = Number(previousData.plannerHours ?? 0);
      const savedData = {
        ...previousData,
        manualOverride: true,
        manualHours: hours,
        plannerOnly: false,
        source: "nightly-review",
        tasks: String(checkin.tasks ?? ""),
        accomplished: String(checkin.accomplished ?? ""),
        difficulties: String(checkin.difficulties ?? ""),
        lesson: String(checkin.lesson ?? ""),
        tomorrow: String(checkin.tomorrow ?? ""),
      };
      const targetMet = checkin.targetMet === true ? 1 : checkin.targetMet === false ? 0 : null;
      await client.query(`INSERT INTO goal_checkins (id,goal_id,checkin_date,worked,hours,output_value,target_met,data_json,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
        ON CONFLICT(goal_id,checkin_date) DO UPDATE SET worked=excluded.worked,hours=excluded.hours,output_value=excluded.output_value,target_met=excluded.target_met,data_json=excluded.data_json,updated_at=excluded.updated_at`,
      [existingCheckin?.id ?? randomUUID(), goalId, body.day, checkin.worked ? 1 : 0, hours, outputValue, targetMet, JSON.stringify({ ...savedData, plannerHours }), timestamp]);
    }
    const habitCheckins = answers.habitCheckins && typeof answers.habitCheckins === "object" ? answers.habitCheckins as Record<string, unknown> : {};
    for (const [ruleId, raw] of Object.entries(habitCheckins)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const checkin = raw as Record<string, unknown>;
      if (!["avoided", "urge_resisted", "slip", "not_applicable"].includes(String(checkin.outcome))) continue;
      const rule = (await client.query<{ id: string }>("SELECT id FROM not_to_do_rules WHERE id=$1 AND archived_at IS NULL AND active=1", [ruleId])).rows[0];
      if (!rule) continue;
      const urges = Math.max(0, Math.min(1000, Math.round(Number(checkin.urges) || 0)));
      const intensityValue = Number(checkin.intensity);
      const intensity = Number.isInteger(intensityValue) && intensityValue >= 1 && intensityValue <= 10 ? intensityValue : null;
      const existingCheckin = (await client.query<{ id: string; outcome: string; urges: number; intensity: number | null; data_json: string }>("SELECT id,outcome,urges,intensity,data_json FROM not_to_do_checkins WHERE rule_id=$1 AND checkin_date=$2", [ruleId, body.day])).rows[0];
      if (existingCheckin) await client.query("INSERT INTO not_to_do_checkin_history (id,checkin_id,previous_json,changed_at) VALUES ($1,$2,$3,$4)", [randomUUID(), existingCheckin.id, JSON.stringify(existingCheckin), timestamp]);
      const habitData = { trigger: String(checkin.trigger ?? ""), emotion: String(checkin.emotion ?? ""), response: String(checkin.response ?? ""), whatHelped: String(checkin.whatHelped ?? ""), lesson: String(checkin.lesson ?? ""), tomorrow: String(checkin.tomorrow ?? ""), source: "nightly-review" };
      await client.query(`INSERT INTO not_to_do_checkins (id,rule_id,checkin_date,outcome,urges,intensity,data_json,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
        ON CONFLICT(rule_id,checkin_date) DO UPDATE SET outcome=excluded.outcome,urges=excluded.urges,intensity=excluded.intensity,data_json=excluded.data_json,updated_at=excluded.updated_at`,
      [existingCheckin?.id ?? randomUUID(), ruleId, body.day, checkin.outcome, urges, intensity, JSON.stringify(habitData), timestamp]);
    }
    const scoreBlocks = fixedPlan
      ? (await client.query<BlockRow>(`SELECT s.id,s.start_time as start,s.end_time as end,s.name,s.category,s.prayer,l.status,l.reason FROM schedule_blocks s LEFT JOIN block_logs l ON l.block_id=s.id WHERE s.plan_day=$1 ORDER BY s.start_time`, [body.day])).rows
      : dayBlocks;
    const normalized = { ...answers, meals: [answers.mealBreakfast, answers.mealLunch, answers.mealDinner].map(value => String(value ?? "")) } as DailyAnswers;
    const scores = calculateScores(normalized, scoreBlocks);
    await client.query(`INSERT INTO nightly_reviews (plan_day,answers_json,safety_count,draft_updated_at,submitted_at,late_entry)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(plan_day) DO UPDATE SET answers_json=excluded.answers_json,safety_count=excluded.safety_count,draft_updated_at=excluded.draft_updated_at,submitted_at=excluded.submitted_at,late_entry=excluded.late_entry,is_demo=0`, [body.day, JSON.stringify(answers), safetyCount, timestamp, timestamp, window.late ? 1 : 0]);
    await client.query("INSERT INTO daily_scores (plan_day,scores_json,created_at,is_demo) VALUES ($1,$2,$3,0) ON CONFLICT(plan_day) DO UPDATE SET scores_json=excluded.scores_json,created_at=excluded.created_at,is_demo=0", [body.day, JSON.stringify(scores), timestamp]);
    return { scores, scoreBlocks };
    });
    await tryWriteDailyBackup();
    const countable = result.scoreBlocks.filter(b => b.category !== "Review");
    return NextResponse.json({ ok: true, scores: result.scores, completion: countable.length ? Math.round(countable.filter(b => b.status === "done").length / countable.length * 100) : 0, lateEntry: window.late });
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("PENDING:")) return NextResponse.json({ error: "Pehle Aaj mein baqi schedule blocks resolve karo.", pending: Number(cause.message.slice(8)) }, { status: 409 });
    return error("Review save nahi ho saka. Dobara try karo.", 500);
  }
}
