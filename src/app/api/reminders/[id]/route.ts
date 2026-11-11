import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { enabled?: boolean; time?: string } | null;
  if (!body || (body.enabled === undefined && body.time === undefined) ||
      (body.time !== undefined && (typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)))) {
    return NextResponse.json({ error: "Invalid reminder update." }, { status: 400 });
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.enabled !== undefined) { values.push(body.enabled ? 1 : 0); fields.push(`enabled=$${values.length}`); }
  if (body.time !== undefined) { values.push(body.time); fields.push(`preferred_time=$${values.length}`); }
  values.push(effectiveServerNow().toISOString()); fields.push(`updated_at=$${values.length}`);
  values.push(id);
  const result = await query(`UPDATE daily_reminders SET ${fields.join(",")} WHERE id=$${values.length}`, values);
  if (!result.rowCount) return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const result = await query("DELETE FROM daily_reminders WHERE id=$1", [id]);
  if (!result.rowCount) return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
