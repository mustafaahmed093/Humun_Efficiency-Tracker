import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";
import { calculateGoalMetrics } from "@/lib/life-system";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(effectiveServerNow());
  const [goals, goalCheckins, habits, habitCheckins, activities, goalHistory] = await Promise.all([
    query<{ id: string; title: string; status: string; start_date: string; target_date: string | null; current_value: number; target_value: number | null; target_unit: string | null }>(
      "SELECT id,title,status,start_date,target_date,current_value,target_value,target_unit FROM goals WHERE archived_at IS NULL ORDER BY is_primary DESC,updated_at DESC"),
    query<{ count: number }>(`SELECT COUNT(*) AS count FROM goal_checkins c JOIN goals g ON g.id=c.goal_id
      WHERE c.checkin_date=$1 AND g.archived_at IS NULL AND g.status NOT IN ('paused','completed','cancelled')`, [date]),
    query<{ id: string; title: string; active: number }>("SELECT id,title,active FROM not_to_do_rules WHERE archived_at IS NULL ORDER BY active DESC,created_at DESC"),
    query<{ count: number }>("SELECT COUNT(*) AS count FROM not_to_do_checkins c JOIN not_to_do_rules r ON r.id=c.rule_id WHERE c.checkin_date=$1 AND r.active=1 AND r.archived_at IS NULL", [date]),
    query<{ total: number; completed: number; partial: number; missed: number }>(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) AS missed
      FROM daily_activities WHERE plan_date=$1`, [date]),
    query<{ goal_id: string; checkin_date: string; hours: number; output_value: number | null; target_met: number | null }>(`SELECT c.goal_id,c.checkin_date,c.hours,c.output_value,c.target_met FROM goal_checkins c JOIN goals g ON g.id=c.goal_id WHERE g.archived_at IS NULL`),
  ]);
  const primaryGoal = goals.rows.find(goal => goal.status !== "completed" && goal.status !== "cancelled") ?? null;
  const activeGoals = goals.rows.filter(goal => !["paused", "completed", "cancelled"].includes(goal.status)).length;
  const activeHabits = habits.rows.filter(rule => Boolean(rule.active)).length;
  const atRiskGoals = goals.rows.filter(goal => ["at_risk", "behind_schedule", "overdue"].includes(calculateGoalMetrics(goal, goalHistory.rows.filter(row=>row.goal_id===goal.id), date).status)).length;
  const upcomingDeadlines = goals.rows.filter(goal => !["paused", "completed", "cancelled"].includes(goal.status) && goal.target_date && goal.target_date >= date && goal.target_date <= new Date(Date.parse(`${date}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)).map(goal => ({ id: goal.id, title: goal.title, date: goal.target_date }));
  const planned = activities.rows[0] ?? { total: 0, completed: 0, partial: 0, missed: 0 };
  return NextResponse.json({
    date, activeGoals, totalGoals: goals.rows.length, primaryGoal, goalCheckins: Number(goalCheckins.rows[0]?.count ?? 0),
    activeHabits, totalHabits: habits.rows.length, habitCheckins: Number(habitCheckins.rows[0]?.count ?? 0),
    pendingGoals: Math.max(0, activeGoals - Number(goalCheckins.rows[0]?.count ?? 0)),
    pendingHabits: Math.max(0, activeHabits - Number(habitCheckins.rows[0]?.count ?? 0)), atRiskGoals,
    overdueGoals: goals.rows.filter(goal => goal.status === "overdue").length, upcomingDeadlines,
    planned: { total: Number(planned.total ?? 0), completed: Number(planned.completed ?? 0), partial: Number(planned.partial ?? 0), missed: Number(planned.missed ?? 0) },
  });
}
