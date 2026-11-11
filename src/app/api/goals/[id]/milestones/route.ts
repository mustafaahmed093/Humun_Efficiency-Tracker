import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: goalId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) return NextResponse.json({ error: "Milestone title is required." }, { status: 400 });
  if (!(await query("SELECT id FROM goals WHERE id=$1 AND archived_at IS NULL", [goalId])).rows.length) {
    return NextResponse.json({ error: "Active goal not found." }, { status: 404 });
  }
  const now = effectiveServerNow().toISOString();
  const id = randomUUID();
  const position = (await query<{ max: number | null }>("SELECT MAX(position) AS max FROM goal_milestones WHERE goal_id=$1", [goalId])).rows[0]?.max ?? -1;
  await query(`INSERT INTO goal_milestones (id,goal_id,title,description,due_date,target_value,status,position,data_json,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$9)`,
  [id, goalId, body.title.trim().slice(0, 200), typeof body.description === "string" ? body.description : null,
    typeof body.dueDate === "string" ? body.dueDate : null,
    typeof body.targetValue === "number" && Number.isFinite(body.targetValue) ? body.targetValue : null,
    position + 1, JSON.stringify(body.data && typeof body.data === "object" ? body.data : {}), now]);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: goalId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "Milestone id is required." }, { status: 400 });
  const updates: string[] = [];
  const values: unknown[] = [];
  const set = (key: string, value: unknown) => { values.push(value); updates.push(`${key}=$${values.length}`); };
  if (typeof body.title === "string" && body.title.trim()) set("title", body.title.trim().slice(0, 200));
  if (typeof body.description === "string" || body.description === null) set("description", body.description);
  if (typeof body.dueDate === "string" || body.dueDate === null) set("due_date", body.dueDate);
  if (typeof body.targetValue === "number" || body.targetValue === null) set("target_value", body.targetValue);
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0) set("position", body.position);
  if (body.completed === true || body.completed === false) {
    set("status", body.completed ? "completed" : "pending");
    set("completed_at", body.completed ? effectiveServerNow().toISOString() : null);
  }
  set("updated_at", effectiveServerNow().toISOString());
  values.push(body.id, goalId);
  const result = await query(`UPDATE goal_milestones SET ${updates.join(",")} WHERE id=$${values.length - 1} AND goal_id=$${values.length}`, values);
  if (!result.rowCount) return NextResponse.json({ error: "Milestone not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: goalId } = await context.params;
  const milestoneId = request.nextUrl.searchParams.get("id");
  if (!milestoneId) return NextResponse.json({ error: "Milestone id is required." }, { status: 400 });
  const result = await query("DELETE FROM goal_milestones WHERE id=$1 AND goal_id=$2", [milestoneId, goalId]);
  if (!result.rowCount) return NextResponse.json({ error: "Milestone not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
