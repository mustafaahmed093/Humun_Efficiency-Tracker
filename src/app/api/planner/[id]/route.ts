import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { findScheduleConflicts } from "@/lib/life-system";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
const categories = ["Business", "Work", "Study", "Health", "Fitness", "Religious", "Family", "Personal", "Sleep", "Other"];
const statuses = ["planned", "completed", "partial", "missed", "rescheduled"];
type Context = { params: Promise<{ id: string }> };
type Activity = { id: string; title: string; start_time: string | null; end_time: string | null; category: string; priority: string; goal_id: string | null; milestone_id: string | null; status: string; data_json: string; position: number };

function validTime(value: unknown, end = false) {
  return value === null || value === undefined || value === "" ||
    (typeof value === "string" && (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || (end && value === "24:00")));
}

function timeOrder(start: string | null, end: string | null) {
  if (!start || !end) return true;
  const toMinutes = (time: string) => time === "24:00" ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const first = toMinutes(start);
  let last = toMinutes(end);
  if (last <= first) last += 1440;
  return last - first <= 1440;
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid activity update." }, { status: 400 });
  const current = (await query<{ plan_date: string; start_time: string | null; end_time: string | null }>(
    "SELECT plan_date,start_time,end_time FROM daily_activities WHERE id=$1", [id])).rows[0];
  if (!current) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (key: string, value: unknown) => { values.push(value); fields.push(`${key}=$${values.length}`); };
  if (typeof body.title === "string" && body.title.trim()) set("title", body.title.trim().slice(0, 200));
  if (typeof body.startTime === "string" || body.startTime === null) {
    if (!validTime(body.startTime)) return NextResponse.json({ error: "Invalid start time." }, { status: 400 });
    set("start_time", body.startTime || null);
  }
  if (typeof body.endTime === "string" || body.endTime === null) {
    if (!validTime(body.endTime, true)) return NextResponse.json({ error: "Invalid end time." }, { status: 400 });
    set("end_time", body.endTime || null);
  }
  const nextStart = body.startTime === undefined ? current.start_time : body.startTime as string | null;
  const nextEnd = body.endTime === undefined ? current.end_time : body.endTime as string | null;
  if (!timeOrder(nextStart, nextEnd)) return NextResponse.json({ error: "An activity cannot exceed 24 hours." }, { status: 400 });
  if (typeof body.category === "string" && categories.includes(body.category)) set("category", body.category);
  if (typeof body.status === "string" && statuses.includes(body.status)) set("status", body.status);
  if (typeof body.actualStart === "string" || body.actualStart === null) set("actual_start", body.actualStart);
  if (typeof body.actualEnd === "string" || body.actualEnd === null) set("actual_end", body.actualEnd);
  if (body.actualDuration === null) set("actual_duration", null);
  else if (typeof body.actualDuration === "number" && Number.isFinite(body.actualDuration) && body.actualDuration >= 0) set("actual_duration", body.actualDuration);
  if (typeof body.goalId === "string" || body.goalId === null) set("goal_id", body.goalId);
  if (typeof body.milestoneId === "string" || body.milestoneId === null) set("milestone_id", body.milestoneId);
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) set("data_json", JSON.stringify(body.data));
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0) set("position", body.position);
  set("updated_at", effectiveServerNow().toISOString());
  values.push(id);
  const result = await query(`UPDATE daily_activities SET ${fields.join(",")} WHERE id=$${values.length}`, values);
  if (!result.rowCount) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  const activities = (await query<Activity>("SELECT * FROM daily_activities WHERE plan_date=$1 ORDER BY position,start_time", [current.plan_date])).rows;
  return NextResponse.json({ ok: true, conflicts: findScheduleConflicts(activities) });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const result = await query("DELETE FROM daily_activities WHERE id=$1", [id]);
  if (!result.rowCount) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
