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
};
function validDay(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= planStart && day <= planEnd; }

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as ImportData | null;
  if (!body || body.formatVersion !== 1 || !Array.isArray(body.scheduleLog) || !Array.isArray(body.reviews) || !Array.isArray(body.dailyScores)) {
    return NextResponse.json({ error: "Ye Command Center JSON export nahi lagti." }, { status: 400 });
  }
  const { scheduleLog, reviews, dailyScores } = body;
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
    return { blocks: logCount, reviews: reviewCount, scores: scoreCount };
    });
    await tryWriteDailyBackup();
    return NextResponse.json({ ok: true, imported });
  } catch {
    return NextResponse.json({ error: "Import nahi ho saka; database unchanged hai." }, { status: 500 });
  }
}
