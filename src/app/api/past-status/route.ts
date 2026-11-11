import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSchedule, planEnd, planStart } from "@/lib/schedule";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const month = request.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Month must use YYYY-MM format." }, { status: 400 });
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${String(daysInMonth(year, monthNumber)).padStart(2, "0")}`;
  const selectedDate = request.nextUrl.searchParams.get("date");
  if (selectedDate && (!datePattern.test(selectedDate) || selectedDate < "2000-01-01" || selectedDate > "2200-12-31")) {
    return NextResponse.json({ error: "Invalid selected date." }, { status: 400 });
  }
  const [logs, activities, reviews, scores, goalEntries, habitEntries, startDates] = await Promise.all([
    query<{ plan_day: string; done: number; missed: number }>(`SELECT plan_day,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) AS missed
      FROM block_logs WHERE plan_day BETWEEN $1 AND $2 GROUP BY plan_day`, [firstDay, lastDay]),
    query<{ plan_date: string; actual: number; done: number; partial: number; missed: number }>(`SELECT plan_date,
      SUM(CASE WHEN status IN ('completed','partial','missed') THEN 1 ELSE 0 END) AS actual,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) AS missed
      FROM daily_activities WHERE plan_date BETWEEN $1 AND $2 GROUP BY plan_date`, [firstDay, lastDay]),
    query<{ plan_day: string; submitted_at: string | null }>("SELECT plan_day,submitted_at FROM nightly_reviews WHERE plan_day BETWEEN $1 AND $2", [firstDay, lastDay]),
    query<{ plan_day: string; scores_json: string }>("SELECT plan_day,scores_json FROM daily_scores WHERE plan_day BETWEEN $1 AND $2", [firstDay, lastDay]),
    query<{ checkin_date: string; count: number }>("SELECT checkin_date,COUNT(*) AS count FROM goal_checkins WHERE checkin_date BETWEEN $1 AND $2 GROUP BY checkin_date", [firstDay, lastDay]),
    query<{ checkin_date: string; count: number }>("SELECT checkin_date,COUNT(*) AS count FROM not_to_do_checkins WHERE checkin_date BETWEEN $1 AND $2 GROUP BY checkin_date", [firstDay, lastDay]),
    query<{ day: string | null }>(`SELECT MIN(day) AS day FROM (
      SELECT MIN(plan_day) AS day FROM block_logs
      UNION ALL SELECT MIN(plan_day) AS day FROM nightly_reviews
      UNION ALL SELECT MIN(plan_date) AS day FROM daily_plans
      UNION ALL SELECT MIN(checkin_date) AS day FROM goal_checkins
      UNION ALL SELECT MIN(checkin_date) AS day FROM not_to_do_checkins
    ) tracking_dates`),
  ]);
  const scoreMap = new Map(scores.rows.map(row => [row.plan_day, JSON.parse(row.scores_json) as Record<string, number>]));
  const logMap = new Map(logs.rows.map(row => [row.plan_day, row]));
  const activityMap = new Map(activities.rows.map(row => [row.plan_date, row]));
  const reviewMap = new Map(reviews.rows.map(row => [row.plan_day, Boolean(row.submitted_at)]));
  const goalMap = new Map(goalEntries.rows.map(row => [row.checkin_date, row.count]));
  const habitMap = new Map(habitEntries.rows.map(row => [row.checkin_date, row.count]));
  const totalDays = daysInMonth(year, monthNumber);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const leading = (firstWeekday + 6) % 7;
  const days = Array.from({ length: totalDays }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const oldLog = logMap.get(date);
    const newActivities = activityMap.get(date);
    const scoresForDay = scoreMap.get(date);
    const actualRecorded = Boolean(oldLog || newActivities?.actual || scoresForDay || reviewMap.has(date) || goalMap.has(date) || habitMap.has(date));
    const planSlots = oldLog ? getSchedule(date).filter(block => block.category !== "Review").length : 0;
    const scheduled = (newActivities?.actual ?? 0) + planSlots;
    const done = (newActivities?.done ?? 0) + (oldLog?.done ?? 0);
    const missed = (newActivities?.missed ?? 0) + (oldLog?.missed ?? 0);
    const score = scoresForDay?.overall ?? null;
    return {
      date, actualRecorded, scheduled, done, missed, partial: newActivities?.partial ?? 0,
      completion: scheduled ? Math.round(done / scheduled * 100) : null,
      score: typeof score === "number" ? score : null,
      reviewComplete: reviewMap.get(date) ?? false,
      goalCheckins: goalMap.get(date) ?? 0,
      habitCheckins: habitMap.get(date) ?? 0,
    };
  });
  const minRecorded = startDates.rows[0]?.day ?? new Date().toISOString().slice(0, 10);
  if (selectedDate) {
    const [dayLog, dayActivities, review, goalCheckins, habitCheckins] = await Promise.all([
      query("SELECT block_id,plan_day,status,reason,updated_at FROM block_logs WHERE plan_day=$1 ORDER BY updated_at", [selectedDate]),
      query("SELECT * FROM daily_activities WHERE plan_date=$1 ORDER BY position,start_time", [selectedDate]),
      query("SELECT * FROM nightly_reviews WHERE plan_day=$1", [selectedDate]),
      query("SELECT g.title,c.* FROM goal_checkins c JOIN goals g ON g.id=c.goal_id WHERE c.checkin_date=$1", [selectedDate]),
      query("SELECT r.title,c.* FROM not_to_do_checkins c JOIN not_to_do_rules r ON r.id=c.rule_id WHERE c.checkin_date=$1", [selectedDate]),
    ]);
    const legacy = selectedDate >= planStart && selectedDate <= planEnd
      ? getSchedule(selectedDate).map(block => ({ ...block, status: dayLog.rows.find(row => row.block_id === block.id)?.status ?? "not_recorded" }))
      : [];
    const scoresForDay = scoreMap.get(selectedDate);
    return NextResponse.json({
      month, startDate: minRecorded, days, selected: {
        date: selectedDate,
        activities: dayActivities.rows.length
          ? dayActivities.rows.filter(activity => ["completed", "partial", "missed"].includes(String(activity.status)))
          : legacy,
        checkins: dayLog.rows,
        review: review.rows[0] ? { ...review.rows[0], answers: JSON.parse(String(review.rows[0].answers_json)) } : null,
        scores: scoresForDay ?? null,
        goals: goalCheckins.rows.map(row => ({ ...row, data: JSON.parse(String(row.data_json)) })),
        habits: habitCheckins.rows.map(row => ({ ...row, data: JSON.parse(String(row.data_json)) })),
      },
      leading,
    });
  }
  return NextResponse.json({ month, startDate: minRecorded, days, leading });
}
