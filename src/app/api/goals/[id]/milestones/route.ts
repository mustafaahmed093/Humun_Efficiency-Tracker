import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
function validDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }

export async function POST(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: goalId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) return NextResponse.json({ error: "Milestone title is required." }, { status: 400 });
  if ((body.startDate != null && body.startDate !== "" && !validDate(body.startDate)) || (body.dueDate != null && body.dueDate !== "" && !validDate(body.dueDate)) || (body.startDate && body.dueDate && String(body.dueDate) < String(body.startDate))) return NextResponse.json({ error: "Milestone dates are invalid." }, { status: 400 });
  if (body.targetValue != null && body.targetValue !== "" && (!Number.isFinite(Number(body.targetValue)) || Number(body.targetValue) < 0)) return NextResponse.json({ error: "Milestone target must be zero or greater." }, { status: 400 });
  if (!(await query("SELECT id FROM goals WHERE id=$1 AND archived_at IS NULL", [goalId])).rows.length) {
    return NextResponse.json({ error: "Active goal not found." }, { status: 404 });
  }
  const now = effectiveServerNow().toISOString();
  const id = randomUUID();
  const position = (await query<{ max: number | null }>("SELECT MAX(position) AS max FROM goal_milestones WHERE goal_id=$1", [goalId])).rows[0]?.max ?? -1;
  await query(`INSERT INTO goal_milestones (id,goal_id,title,description,due_date,target_value,status,position,data_json,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$9)`,
  [id, goalId, body.title.trim().slice(0, 200), typeof body.description === "string" ? body.description : null,
    typeof body.dueDate === "string" && body.dueDate ? body.dueDate : null,
    typeof body.targetValue === "number" && Number.isFinite(body.targetValue) ? body.targetValue : null,
    position + 1, JSON.stringify({ ...(body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {}), ...(validDate(body.startDate) ? { startDate: body.startDate } : {}) }), now]);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: goalId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body && Array.isArray(body.reorder)) {
    const reorder = body.reorder as { id?: unknown; position?: unknown }[];
    if (reorder.length > 100 || reorder.some(item => typeof item.id !== "string" || !Number.isInteger(item.position) || Number(item.position) < 0) ||
        new Set(reorder.map(item => item.id)).size !== reorder.length || new Set(reorder.map(item => item.position)).size !== reorder.length) {
      return NextResponse.json({ error: "Milestone order is invalid." }, { status: 400 });
    }
    const existing = await query<{ id: string }>("SELECT id FROM goal_milestones WHERE goal_id=$1", [goalId]);
    if (existing.rows.length !== reorder.length || existing.rows.some(row => !reorder.some(item => item.id === row.id))) {
      return NextResponse.json({ error: "Reorder must include every milestone in this goal." }, { status: 400 });
    }
    const now = effectiveServerNow().toISOString();
    await transaction(async client => {
      for (const item of reorder) await client.query("UPDATE goal_milestones SET position=$1,updated_at=$2 WHERE id=$3 AND goal_id=$4", [item.position, now, item.id, goalId]);
    });
    return NextResponse.json({ ok: true });
  }
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "Milestone id is required." }, { status: 400 });
  if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== "" && !validDate(body.dueDate)) return NextResponse.json({ error: "Milestone due date is invalid." }, { status: 400 });
  if (body.targetValue !== undefined && body.targetValue !== null && (!Number.isFinite(Number(body.targetValue)) || Number(body.targetValue) < 0)) return NextResponse.json({ error: "Milestone target must be zero or greater." }, { status: 400 });
  const updates: string[] = [];
  const values: unknown[] = [];
  const set = (key: string, value: unknown) => { values.push(value); updates.push(`${key}=$${values.length}`); };
  if (typeof body.title === "string" && body.title.trim()) set("title", body.title.trim().slice(0, 200));
  if (typeof body.description === "string" || body.description === null) set("description", body.description);
  if (typeof body.dueDate === "string" || body.dueDate === null) set("due_date", body.dueDate);
  if (typeof body.targetValue === "number" || body.targetValue === null) set("target_value", body.targetValue);
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    const existing = await query<{ data_json: string }>("SELECT data_json FROM goal_milestones WHERE id=$1 AND goal_id=$2", [body.id, goalId]);
    if (!existing.rows.length) return NextResponse.json({ error: "Milestone not found." }, { status: 404 });
    let previous: Record<string, unknown> = {}; try { previous = JSON.parse(existing.rows[0].data_json); } catch { }
    set("data_json", JSON.stringify({ ...previous, ...body.data }));
  }
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
  const result = await query("DELETE FROM goal_milestones WHERE id=$1 AND goal_id=$2 AND status<>'completed'", [milestoneId, goalId]);
  if (!result.rowCount) return NextResponse.json({ error: "Milestone not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
