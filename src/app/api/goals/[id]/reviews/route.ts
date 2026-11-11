import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const reviews = await query<{ id: string; goal_id: string; week_start: string; data_json: string; created_at: string; updated_at: string }>(
    "SELECT * FROM goal_weekly_reviews WHERE goal_id=$1 ORDER BY week_start DESC", [id]);
  return NextResponse.json({ reviews: reviews.rows.map(review => ({ ...review, data: JSON.parse(review.data_json) })) });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: goalId } = await context.params;
  const body = await request.json().catch(() => null) as { weekStart?: string; data?: Record<string, unknown> } | null;
  if (!body?.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart) || !body.data) {
    return NextResponse.json({ error: "Week start and review answers are required." }, { status: 400 });
  }
  const now = effectiveServerNow().toISOString();
  const id = randomUUID();
  const result = await query(`INSERT INTO goal_weekly_reviews (id,goal_id,week_start,data_json,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$5)
    ON CONFLICT(goal_id,week_start) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at`,
  [id, goalId, body.weekStart, JSON.stringify(body.data), now]);
  return NextResponse.json({ ok: true, id, rowCount: result.rowCount }, { status: 201 });
}
