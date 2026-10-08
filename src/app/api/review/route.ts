import { NextRequest, NextResponse } from "next/server";
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
async function currentWindow(now = effectiveServerNow()) {
  const lateEnabled = (await query<{ value: string }>("SELECT value FROM settings WHERE key='late_entry_enabled'")).rows[0]?.value === "true";
  return { ...getReviewWindow(now, lateEnabled), lateEntryEnabled: lateEnabled };
}

function elapsedPlanMinutes(now = effectiveServerNow()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find(part => part.type === "hour")?.value) * 60 + Number(parts.find(part => part.type === "minute")?.value) + 1440;
}

function isDue(block: BlockRow, minutes: number) {
  const [hours, mins] = block.end.split(":").map(Number);
  return hours * 60 + mins <= minutes;
}

async function rowsForDay(day: string): Promise<BlockRow[]> {
  const rows = (await query<BlockRow>(`SELECT s.id,s.start_time as start,s.end_time as end,s.name,s.category,s.prayer,l.status,l.reason
    FROM schedule_blocks s LEFT JOIN block_logs l ON l.block_id=s.id
    WHERE s.plan_day=$1 ORDER BY s.start_time`, [day])).rows;
  return rows.length ? rows : getSchedule(day).map(block => ({ ...block, prayer: block.prayer ?? null, status: null, reason: null }));
}

export async function GET(request: NextRequest) {
  if (!unlocked(request)) return error("Unlock the local app first.", 401);
  const window = await currentWindow();
  const day = request.nextUrl.searchParams.get("date") ?? window.targetDay;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < planStart || day > planEnd) {
    return NextResponse.json({ window, day, inPlan: false, blocks: [], review: null });
  }
  const row = (await query<ReviewRow>("SELECT plan_day,answers_json,safety_count,draft_updated_at,submitted_at,late_entry FROM nightly_reviews WHERE plan_day=$1", [day])).rows[0];
  const answers: AnswerRecord = row ? { ...JSON.parse(row.answers_json), safetyCheck: ["Nahi", "Halka", "Tez"][row.safety_count] } : {};
  const blocks = await rowsForDay(day);
  const pending = blocks.filter(block => block.category !== "Review" && isDue(block, elapsedPlanMinutes()) && !block.status).length;
  const savedScores = (await query<{ scores_json: string }>("SELECT scores_json FROM daily_scores WHERE plan_day=$1", [day])).rows[0];
  const countable = blocks.filter(block => block.category !== "Review");
  const completion = countable.length ? Math.round(countable.filter(block => block.status === "done").length / countable.length * 100) : 0;
  return NextResponse.json({ window, day, inPlan: true, blocks, pending, review: row ? { answers, submittedAt: row.submitted_at, lateEntry: Boolean(row.late_entry), draftUpdatedAt: row.draft_updated_at } : null, summary: row?.submitted_at && savedScores ? { scores: JSON.parse(savedScores.scores_json), completion } : null });
}

export async function POST(request: NextRequest) {
  if (!unlocked(request)) return error("Unlock the local app first.", 401);
  const window = await currentWindow();
  if (!window.open) return NextResponse.json({ error: "Raat ka Review abhi locked hai.", window }, { status: 423 });
  const body = await request.json().catch(() => null) as { action?: string; day?: string; answers?: AnswerRecord } | null;
  if (!body || !body.day || body.day !== window.targetDay || body.day < planStart || body.day > planEnd || !body.answers || typeof body.answers !== "object") {
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
  if (!prayerAnswers || prayerNames.some(name => typeof prayerAnswers[name] !== "boolean")) {
    return error("Paanch namazon ka status select karo.", 400);
  }
  const dayBlocks = await rowsForDay(body.day);
  try {
    const result = await transaction(async client => {
    const prayerInsert = `INSERT INTO block_logs (block_id,plan_day,status,reason,updated_at) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(block_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,updated_at=excluded.updated_at,is_demo=0`;
    for (const block of dayBlocks) {
      if (block.prayer && typeof prayerAnswers[block.prayer] === "boolean") {
        const isDone = prayerAnswers[block.prayer];
        const reason = isDone ? null : block.status === "missed" && block.reason ? block.reason : "Marked not done in Raat ka Review";
        await client.query(prayerInsert, [block.id, body.day, isDone ? "done" : "missed", reason, timestamp]);
      }
    }
    const pending = (await client.query<BlockRow>(`SELECT s.id,s.start_time as start,s.end_time as end,s.name,s.category,s.prayer,l.status,l.reason FROM schedule_blocks s LEFT JOIN block_logs l ON l.block_id=s.id WHERE s.plan_day=$1 ORDER BY s.start_time`, [body.day])).rows.filter(block => block.category !== "Review" && isDue(block, elapsedPlanMinutes()) && !block.status);
    if (pending.length) {
      throw new Error("PENDING:" + pending.length);
    }
    const scoreBlocks = (await client.query<BlockRow>(`SELECT s.id,s.start_time as start,s.end_time as end,s.name,s.category,s.prayer,l.status,l.reason FROM schedule_blocks s LEFT JOIN block_logs l ON l.block_id=s.id WHERE s.plan_day=$1 ORDER BY s.start_time`, [body.day])).rows;
    const normalized = { ...answers, meals: [answers.mealBreakfast, answers.mealLunch, answers.mealDinner].map(value => String(value ?? "")) } as DailyAnswers;
    const scores = calculateScores(normalized, scoreBlocks);
    await client.query(`INSERT INTO nightly_reviews (plan_day,answers_json,safety_count,draft_updated_at,submitted_at,late_entry)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(plan_day) DO UPDATE SET answers_json=excluded.answers_json,safety_count=excluded.safety_count,draft_updated_at=excluded.draft_updated_at,submitted_at=excluded.submitted_at,late_entry=excluded.late_entry,is_demo=0`, [body.day, JSON.stringify(answers), safetyCount, timestamp, timestamp, window.late ? 1 : 0]);
    await client.query("INSERT INTO daily_scores (plan_day,scores_json,created_at,is_demo) VALUES ($1,$2,$3,0) ON CONFLICT(plan_day) DO UPDATE SET scores_json=excluded.scores_json,created_at=excluded.created_at,is_demo=0", [body.day, JSON.stringify(scores), timestamp]);
    return { scores, scoreBlocks };
    });
    await tryWriteDailyBackup();
    const countable = result.scoreBlocks.filter(b => b.category !== "Review");
    return NextResponse.json({ ok: true, scores: result.scores, completion: Math.round(countable.filter(b => b.status === "done").length / countable.length * 100), lateEntry: window.late });
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("PENDING:")) return NextResponse.json({ error: "Pehle Aaj mein baqi schedule blocks resolve karo.", pending: Number(cause.message.slice(8)) }, { status: 409 });
    return error("Review save nahi ho saka. Dobara try karo.", 500);
  }
}
