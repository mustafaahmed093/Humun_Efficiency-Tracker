import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { isUnlocked } from "@/lib/auth";
import { effectiveServerNow } from "@/lib/server-time";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const result = await query("SELECT * FROM goal_checkins WHERE goal_id=$1 ORDER BY checkin_date DESC", [id]);
  return NextResponse.json({ checkins: result.rows.map(row => ({ ...row, data: JSON.parse(String(row.data_json)) })) });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: goalId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const date = body?.date;
  const hours = body?.hours === undefined ? 0 : Number(body.hours);
  if (!body || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof body.worked !== "boolean" || !Number.isFinite(hours) || hours < 0 || hours > 24) {
    return NextResponse.json({ error: "Date, worked status, and valid hours are required." }, { status: 400 });
  }
  const outputValue = body.outputValue === null || body.outputValue === undefined || body.outputValue === ""
    ? null : Number(body.outputValue);
  if (outputValue !== null && (!Number.isFinite(outputValue) || outputValue < 0)) {
    return NextResponse.json({ error: "Output must be a non-negative number." }, { status: 400 });
  }
  const targetMet = body.targetMet === true ? 1 : body.targetMet === false ? 0 : null;
  const now = effectiveServerNow().toISOString();
  const id = randomUUID();
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  const result = await transaction(async client => {
    const goal = (await client.query<{ id: string }>("SELECT id FROM goals WHERE id=$1 AND archived_at IS NULL", [goalId])).rows[0];
    if (!goal) return { error: "Active goal not found." };
    const existing = (await client.query<{ id: string; worked: number; hours: number; output_value: number | null; target_met: number | null; data_json: string }>(
      "SELECT id,worked,hours,output_value,target_met,data_json FROM goal_checkins WHERE goal_id=$1 AND checkin_date=$2", [goalId, date])).rows[0];
    if (existing) {
      await client.query("INSERT INTO goal_checkin_history (id,checkin_id,previous_json,changed_at) VALUES ($1,$2,$3,$4)",
        [randomUUID(), existing.id, JSON.stringify(existing), now]);
    }
    const checkinId = existing?.id ?? id;
    await client.query(`INSERT INTO goal_checkins (id,goal_id,checkin_date,worked,hours,output_value,target_met,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
      ON CONFLICT(goal_id,checkin_date) DO UPDATE SET worked=excluded.worked,hours=excluded.hours,
        output_value=excluded.output_value,target_met=excluded.target_met,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [checkinId, goalId, date, body.worked ? 1 : 0, hours, outputValue, targetMet, JSON.stringify(data), now]);
    return { id: checkinId, updated: Boolean(existing) };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, ...result }, { status: result.updated ? 200 : 201 });
}
