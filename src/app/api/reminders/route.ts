import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const rows = await query<{ id: string; kind: string; reference_id: string | null; enabled: number; preferred_time: string | null; frequency: string; data_json: string }>(
    "SELECT * FROM daily_reminders ORDER BY enabled DESC,preferred_time");
  return NextResponse.json({ reminders: rows.rows.map(row => ({ ...row, enabled: Boolean(row.enabled), data: JSON.parse(row.data_json) })) });
}

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as { title?: string; time?: string; frequency?: string; weekday?: number; kind?: string } | null;
  const kinds = ["custom", "goal_session", "milestone", "goal_deadline", "not_to_do", "schedule", "nightly_review", "weekly_goal_review"];
  if (!body || typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120 ||
      typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ||
      !["daily", "weekly"].includes(String(body.frequency)) ||
      (body.kind !== undefined && !kinds.includes(body.kind)) ||
      (body.frequency === "weekly" && (!Number.isInteger(body.weekday) || Number(body.weekday) < 0 || Number(body.weekday) > 6))) {
    return NextResponse.json({ error: "Enter a reminder title, valid time, and schedule." }, { status: 400 });
  }
  const id = randomUUID();
  const now = effectiveServerNow().toISOString();
  await query("INSERT INTO daily_reminders (id,kind,enabled,preferred_time,frequency,data_json,created_at,updated_at) VALUES ($1,$2,1,$3,$4,$5,$6,$6)",
    [id, body.kind ?? "custom", body.time, body.frequency, JSON.stringify({ title: body.title.trim(), weekday: body.weekday ?? null }), now]);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
