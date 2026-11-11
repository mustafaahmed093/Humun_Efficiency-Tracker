import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { isUnlocked } from "@/lib/auth";
import { effectiveServerNow } from "@/lib/server-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const goal = (await query<{ data_json: string }>("SELECT * FROM goals WHERE id=$1", [id])).rows[0];
  if (!goal) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
  const [milestones, checkins, reviews, dependencies, deadlineHistory] = await Promise.all([
    query("SELECT * FROM goal_milestones WHERE goal_id=$1 ORDER BY position,due_date", [id]),
    query("SELECT * FROM goal_checkins WHERE goal_id=$1 ORDER BY checkin_date DESC", [id]),
    query("SELECT * FROM goal_weekly_reviews WHERE goal_id=$1 ORDER BY week_start DESC", [id]),
    query<{ goal_id: string; depends_on_goal_id: string; title: string }>(
      "SELECT d.goal_id,d.depends_on_goal_id,g.title FROM goal_dependencies d JOIN goals g ON g.id=d.depends_on_goal_id WHERE d.goal_id=$1", [id]),
    query("SELECT * FROM goal_deadline_history WHERE goal_id=$1 ORDER BY changed_at DESC", [id]),
  ]);
  return NextResponse.json({
    goal: { ...goal, data: JSON.parse(goal.data_json) },
    milestones: milestones.rows,
    checkins: checkins.rows.map(row => ({ ...row, data: JSON.parse(String(row.data_json)) })),
    reviews: reviews.rows.map(row => ({ ...row, data: JSON.parse(String(row.data_json)) })),
    dependencies: dependencies.rows,
    deadlineHistory: deadlineHistory.rows,
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid goal update." }, { status: 400 });
  const current = (await query<{ target_date: string | null; data_json: string; status: string }>(
    "SELECT target_date,data_json,status FROM goals WHERE id=$1", [id])).rows[0];
  if (!current) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
  const updates: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => { values.push(value); updates.push(`${column}=$${values.length}`); };
  if (typeof body.title === "string" && body.title.trim() && body.title.length <= 200) set("title", body.title.trim());
  if (typeof body.category === "string" && body.category.trim()) set("category", body.category.trim());
  if (["critical", "high", "medium", "low"].includes(String(body.priority))) set("priority", body.priority);
  if (["active", "paused", "completed", "cancelled"].includes(String(body.status))) set("status", body.status);
  if (body.targetDate === null || (typeof body.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate))) set("target_date", body.targetDate);
  if (body.targetValue === null || (typeof body.targetValue === "number" && Number.isFinite(body.targetValue) && body.targetValue >= 0)) set("target_value", body.targetValue);
  if (typeof body.currentValue === "number" && Number.isFinite(body.currentValue) && body.currentValue >= 0) set("current_value", body.currentValue);
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) set("data_json", JSON.stringify(body.data));
  const isPrimary = body.isPrimary === true;
  if (body.isPrimary === true || body.isPrimary === false) set("is_primary", isPrimary ? 1 : 0);
  const now = effectiveServerNow().toISOString();
  set("updated_at", now);
  values.push(id);
  await transaction(async client => {
    if (isPrimary) await client.query("UPDATE goals SET is_primary=0 WHERE archived_at IS NULL");
    if (current.target_date !== (body.targetDate ?? current.target_date)) {
      await client.query("INSERT INTO goal_deadline_history (id,goal_id,previous_deadline,next_deadline,changed_at,reason) VALUES ($1,$2,$3,$4,$5,$6)",
        [crypto.randomUUID(), id, current.target_date, body.targetDate ?? null, now, typeof body.deadlineChangeReason === "string" ? body.deadlineChangeReason : null]);
    }
    if (updates.length) await client.query(`UPDATE goals SET ${updates.join(",")} WHERE id=$${values.length}`, values);
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const result = await query("UPDATE goals SET archived_at=$1,is_primary=0,updated_at=$1 WHERE id=$2 AND archived_at IS NULL",
    [effectiveServerNow().toISOString(), id]);
  if (!result.rowCount) return NextResponse.json({ error: "Goal not found or already archived." }, { status: 404 });
  return NextResponse.json({ ok: true, archived: true });
}
