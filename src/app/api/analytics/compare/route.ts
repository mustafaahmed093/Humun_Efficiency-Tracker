import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Period = { from: string; to: string };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

async function summarize(period: Period) {
  const [legacy, activities, scores, goals, habits, reviews] = await Promise.all([
    query<{ done: number; tracked: number }>(`SELECT
      SUM(CASE WHEN l.status='done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN l.status IN ('done','missed') THEN 1 ELSE 0 END) AS tracked
      FROM schedule_blocks s LEFT JOIN block_logs l ON l.block_id=s.id
      WHERE s.plan_day BETWEEN $1 AND $2`, [period.from, period.to]),
    query<{ done: number; tracked: number }>(`SELECT
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status IN ('completed','partial','missed') THEN 1 ELSE 0 END) AS tracked
      FROM daily_activities WHERE plan_date BETWEEN $1 AND $2`, [period.from, period.to]),
    query<{ scores_json: string }>("SELECT scores_json FROM daily_scores WHERE plan_day BETWEEN $1 AND $2", [period.from, period.to]),
    query<{ checkins: number; hours: number }>("SELECT COUNT(*) AS checkins,COALESCE(SUM(hours),0) AS hours FROM goal_checkins WHERE checkin_date BETWEEN $1 AND $2", [period.from, period.to]),
    query<{ total: number; successful: number }>(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN outcome IN ('avoided','urge_resisted') THEN 1 ELSE 0 END) AS successful
      FROM not_to_do_checkins WHERE checkin_date BETWEEN $1 AND $2`, [period.from, period.to]),
    query<{ submitted: number }>("SELECT COUNT(*) AS submitted FROM nightly_reviews WHERE submitted_at IS NOT NULL AND plan_day BETWEEN $1 AND $2", [period.from, period.to]),
  ]);
  const done = Number(legacy.rows[0]?.done ?? 0) + Number(activities.rows[0]?.done ?? 0);
  const tracked = Number(legacy.rows[0]?.tracked ?? 0) + Number(activities.rows[0]?.tracked ?? 0);
  const rows = scores.rows.map(row => JSON.parse(row.scores_json) as Record<string, number>);
  const dimensions = ["overall", "business", "health", "mental", "focus", "religious"];
  const averageScores = Object.fromEntries(dimensions.map(key => [
    key, rows.length ? Math.round(rows.reduce((sum, score) => sum + Number(score[key] ?? 0), 0) / rows.length) : null,
  ]));
  const habitTotal = Number(habits.rows[0]?.total ?? 0);
  const habitSuccessful = Number(habits.rows[0]?.successful ?? 0);
  return {
    ...period,
    trackedBlocks: tracked,
    completion: tracked ? Math.round(done / tracked * 100) : null,
    submittedReviews: Number(reviews.rows[0]?.submitted ?? 0),
    averageScores,
    goalCheckins: Number(goals.rows[0]?.checkins ?? 0),
    goalHours: Math.round(Number(goals.rows[0]?.hours ?? 0) * 100) / 100,
    habitCheckins: habitTotal,
    habitConsistency: habitTotal ? Math.round(habitSuccessful / habitTotal * 100) : null,
  };
}

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const periods = [
    { from: params.get("fromA") ?? "", to: params.get("toA") ?? "" },
    { from: params.get("fromB") ?? "", to: params.get("toB") ?? "" },
  ];
  if (periods.some(period => !validDate(period.from) || !validDate(period.to) || period.from > period.to)) {
    return NextResponse.json({ error: "Both comparison periods must be valid date ranges." }, { status: 400 });
  }
  if (periods.some(period => Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`) > 366 * 86_400_000)) {
    return NextResponse.json({ error: "Each comparison range is limited to 367 days." }, { status: 400 });
  }
  const [first, second] = await Promise.all(periods.map(summarize));
  return NextResponse.json({ periods: [first, second] });
}
