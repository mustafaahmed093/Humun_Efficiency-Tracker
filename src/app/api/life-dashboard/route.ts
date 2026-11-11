import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(effectiveServerNow());
  const [goals, goalCheckins, habits, habitCheckins, activities] = await Promise.all([
    query<{ id: string; title: string; status: string; target_date: string | null; current_value: number; target_value: number | null }>(
      "SELECT id,title,status,target_date,current_value,target_value FROM goals WHERE archived_at IS NULL ORDER BY is_primary DESC,updated_at DESC"),
    query<{ count: number }>("SELECT COUNT(*) AS count FROM goal_checkins WHERE checkin_date=$1", [date]),
    query<{ id: string; title: string; active: number }>("SELECT id,title,active FROM not_to_do_rules WHERE archived_at IS NULL ORDER BY active DESC,created_at DESC"),
    query<{ count: number }>("SELECT COUNT(*) AS count FROM not_to_do_checkins WHERE checkin_date=$1", [date]),
    query<{ total: number; completed: number; partial: number; missed: number }>(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) AS missed
      FROM daily_activities WHERE plan_date=$1`, [date]),
  ]);
  const primaryGoal = goals.rows.find(goal => goal.status !== "completed" && goal.status !== "cancelled") ?? null;
  const activeGoals = goals.rows.filter(goal => !["paused", "completed", "cancelled"].includes(goal.status)).length;
  const activeHabits = habits.rows.filter(rule => Boolean(rule.active)).length;
  const planned = activities.rows[0] ?? { total: 0, completed: 0, partial: 0, missed: 0 };
  return NextResponse.json({
    date, activeGoals, totalGoals: goals.rows.length, primaryGoal, goalCheckins: Number(goalCheckins.rows[0]?.count ?? 0),
    activeHabits, totalHabits: habits.rows.length, habitCheckins: Number(habitCheckins.rows[0]?.count ?? 0),
    planned: { total: Number(planned.total ?? 0), completed: Number(planned.completed ?? 0), partial: Number(planned.partial ?? 0), missed: Number(planned.missed ?? 0) },
  });
}
