import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { findScheduleConflicts } from "@/lib/life-system";
import { getSchedule, planStart } from "@/lib/schedule";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";
import { getPlannerDurationMinutes } from "@/lib/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const categories = ["Business", "Work", "Study", "Health", "Fitness", "Religious", "Family", "Personal", "Sleep", "Other"];
type Activity = { id: string; title: string; start_time: string | null; end_time: string | null; category: string; priority: string; goal_id: string | null; milestone_id: string | null; status: string; data_json: string; position: number };

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validTime(value: unknown, end = false) {
  return value === null || value === undefined || value === "" ||
    (typeof value === "string" && (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || (end && value === "24:00")));
}

function timeOrder(start: string | null, end: string | null) {
  if (!start || !end) return true;
  const toMinutes = (time: string) => time === "24:00" ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const a = toMinutes(start);
  let b = toMinutes(end);
  if (b <= a) b += 1440;
  return b - a <= 1440;
}

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date") ?? planStart;
  if (!validDate(date)) return NextResponse.json({ error: "Invalid plan date." }, { status: 400 });
  const [plan, activities] = await Promise.all([
    query<{ source: string; data_json: string; created_at: string; updated_at: string }>("SELECT * FROM daily_plans WHERE plan_date=$1", [date]),
    query<Activity>("SELECT * FROM daily_activities WHERE plan_date=$1 ORDER BY position,start_time", [date]),
  ]);
  return NextResponse.json({
    date,
    plan: plan.rows[0] ? { source: plan.rows[0].source, ...JSON.parse(plan.rows[0].data_json), createdAt: plan.rows[0].created_at, updatedAt: plan.rows[0].updated_at } : null,
    activities: activities.rows.map(activity => ({ ...activity, data: JSON.parse(activity.data_json) })),
    conflicts: findScheduleConflicts(activities.rows),
  });
}

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !validDate(body.date)) return NextResponse.json({ error: "A valid plan date is required." }, { status: 400 });
  const now = effectiveServerNow().toISOString();
  if (body.action === "apply-blueprint") {
    const existing = (await query<{ count: number }>("SELECT COUNT(*) AS count FROM daily_activities WHERE plan_date=$1", [body.date])).rows[0]?.count ?? 0;
    if (Number(existing) > 0) return NextResponse.json({ error: "This date already has activities. Export or remove them first, then apply the blueprint." }, { status: 409 });
    const day = typeof body.blueprintDay === "string" && validDate(body.blueprintDay) ? body.blueprintDay : planStart;
    const blocks = getSchedule(day);
    await transaction(async client => {
      await client.query("INSERT INTO daily_plans (plan_date,source,data_json,created_at,updated_at) VALUES ($1,'blueprint',$2,$3,$3) ON CONFLICT(plan_date) DO NOTHING",
        [body.date, JSON.stringify({ blueprintDay: day }), now]);
      for (let position = 0; position < blocks.length; position++) {
        const block = blocks[position];
        await client.query(`INSERT INTO daily_activities
          (id,plan_date,title,start_time,end_time,category,priority,status,data_json,position,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,'medium','planned',$7,$8,$9,$9)`,
        [randomUUID(), body.date, block.name, block.start, block.end, block.category,
          JSON.stringify({ prayer: block.prayer ?? null, blueprintBlockId: block.id, description: "" }), position, now]);
      }
    });
    return NextResponse.json({ ok: true, applied: blocks.length });
  }
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200 ||
      typeof body.category !== "string" || !categories.includes(body.category) ||
      !validTime(body.startTime, false) || !validTime(body.endTime, true)) {
    return NextResponse.json({ error: "Activity title, category, or time is invalid." }, { status: 400 });
  }
  const title = body.title.trim();
  const category = body.category;
  const start = typeof body.startTime === "string" && body.startTime ? body.startTime : null;
  const end = typeof body.endTime === "string" && body.endTime ? body.endTime : null;
  if (!timeOrder(start, end)) return NextResponse.json({ error: "An activity cannot exceed 24 hours." }, { status: 400 });
  const activityData = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as Record<string, unknown> : {};
  const endDate = activityData.endDate === undefined ? body.date : activityData.endDate;
  if (!validDate(endDate) || (start && end && getPlannerDurationMinutes(body.date, start, endDate, end) === null)) {
    return NextResponse.json({ error: "Activity end date and time must define a duration of no more than 24 hours." }, { status: 400 });
  }
  const existing = (await query<{ id: string; title: string; start_time: string | null; end_time: string | null; goal_id: string | null }>(
    "SELECT id,title,start_time,end_time,goal_id FROM daily_activities WHERE plan_date=$1", [body.date])).rows;
  if (existing.some(activity => activity.title.trim().toLowerCase() === title.toLowerCase() &&
    activity.start_time === start && activity.end_time === end && activity.goal_id === (typeof body.goalId === "string" ? body.goalId : null))) {
    return NextResponse.json({ error: "An activity with the same title, time, and goal already exists on this date." }, { status: 409 });
  }
  const id = randomUUID();
  const position = (await query<{ max: number | null }>("SELECT MAX(position) AS max FROM daily_activities WHERE plan_date=$1", [body.date])).rows[0]?.max ?? -1;
  await transaction(async client => {
    await client.query("INSERT INTO daily_plans (plan_date,source,data_json,created_at,updated_at) VALUES ($1,'custom','{}',$2,$2) ON CONFLICT(plan_date) DO NOTHING", [body.date, now]);
    await client.query(`INSERT INTO daily_activities (id,plan_date,title,start_time,end_time,category,priority,goal_id,milestone_id,status,data_json,position,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planned',$10,$11,$12,$12)`,
    [id, body.date, title, start, end,
      category, ["critical", "high", "medium", "low"].includes(String(body.priority)) ? body.priority : "medium",
      typeof body.goalId === "string" ? body.goalId : null, typeof body.milestoneId === "string" ? body.milestoneId : null,
      JSON.stringify(activityData), position + 1, now]);
    await client.query("UPDATE daily_plans SET updated_at=$1 WHERE plan_date=$2", [now, body.date]);
  });
  const activities = (await query<Activity>("SELECT * FROM daily_activities WHERE plan_date=$1 ORDER BY position,start_time", [body.date])).rows;
  return NextResponse.json({ ok: true, id, conflicts: findScheduleConflicts(activities).filter(pair => pair.first === id || pair.second === id) }, { status: 201 });
}
