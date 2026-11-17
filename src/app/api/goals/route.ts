import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { calculateGoalMetrics } from "@/lib/life-system";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GoalRow = {
  id: string; title: string; category: string; priority: string; goal_type: string;
  status: string; start_date: string; target_date: string | null; target_value: number | null;
  target_unit: string | null; current_value: number; is_primary: number; archived_at: string | null;
  data_json: string; created_at: string; updated_at: string;
};

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const rows = (await query<GoalRow>(`SELECT * FROM goals ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY is_primary DESC, updated_at DESC`)).rows;
  const goals = await Promise.all(rows.map(async goal => {
    const [checkins, milestones] = await Promise.all([
      query<{ checkin_date: string; hours: number; output_value: number | null; target_met: number | null }>(
        "SELECT checkin_date,hours,output_value,target_met FROM goal_checkins WHERE goal_id=$1 ORDER BY checkin_date", [goal.id]),
      query<{ id: string; title: string; description: string | null; due_date: string | null; target_value: number | null; status: string; position: number; completed_at: string | null; data_json: string }>(
        "SELECT id,title,description,due_date,target_value,status,position,completed_at,data_json FROM goal_milestones WHERE goal_id=$1 ORDER BY position,due_date", [goal.id]),
    ]);
    return {
      ...goal,
      is_primary: Boolean(goal.is_primary),
      data: JSON.parse(goal.data_json),
      metrics: calculateGoalMetrics(goal, checkins.rows, effectiveServerNow().toISOString().slice(0, 10)),
      milestones: milestones.rows.map(item=>({...item,data:JSON.parse(item.data_json)})),
    };
  }));
  return NextResponse.json({ goals });
}

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string" || !body.title.trim() || body.title.length > 200 ||
      typeof body.category !== "string" || !body.category.trim()) {
    return NextResponse.json({ error: "Goal title and category are required." }, { status: 400 });
  }
  const title = body.title.trim();
  const category = body.category.trim();
  const now = effectiveServerNow().toISOString();
  const startDate = validDate(body.startDate) ? body.startDate : now.slice(0, 10);
  const targetDate = body.targetDate === null || body.targetDate === "" || body.targetDate === undefined
    ? null
    : validDate(body.targetDate) ? body.targetDate : undefined;
  if (targetDate === undefined || (targetDate && targetDate < startDate)) {
    return NextResponse.json({ error: "Goal dates are invalid." }, { status: 400 });
  }
  const targetValue = body.targetValue === null || body.targetValue === "" || body.targetValue === undefined
    ? null
    : Number(body.targetValue);
  if (targetValue !== null && (!Number.isFinite(targetValue) || targetValue < 0)) {
    return NextResponse.json({ error: "Target must be a non-negative number." }, { status: 400 });
  }
  const id = randomUUID();
  const isPrimary = body.isPrimary === true;
  const priority = ["critical", "high", "medium", "low"].includes(String(body.priority)) ? String(body.priority) : "medium";
  const goalType = ["one_time", "recurring", "continuous", "personal"].includes(String(body.goalType)) ? String(body.goalType) : "one_time";
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  await transaction(async client => {
    if (isPrimary) await client.query("UPDATE goals SET is_primary=0 WHERE archived_at IS NULL");
    await client.query(`INSERT INTO goals
      (id,title,category,priority,goal_type,status,start_date,target_date,target_value,target_unit,current_value,is_primary,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
    [id, title, category, priority, goalType, startDate, targetDate, targetValue,
      typeof body.targetUnit === "string" ? body.targetUnit.trim().slice(0, 40) : null,
      Number.isFinite(Number(body.currentValue)) && Number(body.currentValue) >= 0 ? Number(body.currentValue) : 0,
      isPrimary ? 1 : 0, JSON.stringify(data), now]);
  });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
