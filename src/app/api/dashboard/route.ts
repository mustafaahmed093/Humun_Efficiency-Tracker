import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSchedule, planEnd, planStart } from "@/lib/schedule";
import { planDayForDate } from "@/lib/schedule";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ScoreRow = { plan_day: string; scores_json: string };
type ReviewRow = { plan_day: string; answers_json: string };
type LogRow = { block_id: string; status: "done" | "missed"; reason: string | null };
const dimensions = ["business", "health", "mental", "focus", "religious", "overall"] as const;

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const effectiveNow = effectiveServerNow();
  const today = request.nextUrl.searchParams.get("date") ?? planDayForDate(effectiveNow);
  if (today < planStart || today > planEnd) return NextResponse.json({ error: "Today is outside the plan." }, { status: 400 });
  const scoreRows = (await query<ScoreRow>("SELECT plan_day,scores_json FROM daily_scores WHERE plan_day BETWEEN $1 AND $2 ORDER BY plan_day", [planStart, planEnd])).rows;
  const scoresByDay = new Map(scoreRows.map(row => [row.plan_day, JSON.parse(row.scores_json) as Record<string, number>]));
  const reviews = (await query<ReviewRow>("SELECT plan_day,answers_json FROM nightly_reviews WHERE submitted_at IS NOT NULL AND plan_day<=$1 ORDER BY plan_day", [today])).rows;
  const reviewsByDay = new Map(reviews.map(row => [row.plan_day, JSON.parse(row.answers_json) as Record<string, unknown>]));
  const days = Array.from({ length: 15 }, (_, i) => new Date(Date.UTC(2026, 9, 7 + i)).toISOString().slice(0, 10));
  const completionByDay = new Map<string, number>();
  for (const day of days) {
    const blocks = getSchedule(day).filter(block => block.category !== "Review");
    const logs = (await query<LogRow>("SELECT block_id,status,reason FROM block_logs WHERE plan_day=$1", [day])).rows;
    completionByDay.set(day, blocks.length ? Math.round(logs.filter(log => log.status === "done" && blocks.some(block => block.id === log.block_id)).length / blocks.length * 100) : 0);
  }
  const scoreDays = scoreRows.map(row => row.plan_day);
  const latestDay = scoreDays.filter(d => d <= today).at(-1);
  const lastThree = scoreRows.filter(row => row.plan_day <= today).slice(-3);
  const previousThree = scoreRows.filter(row => row.plan_day <= today).slice(-6, -3);
  const trends = Object.fromEntries(dimensions.map(key => {
    const mean = (rows: ScoreRow[]) => rows.length ? rows.reduce((sum, row) => sum + (JSON.parse(row.scores_json) as Record<string, number>)[key], 0) / rows.length : null;
    const current = mean(lastThree); const previous = mean(previousThree);
    const delta = current === null || previous === null ? 0 : current - previous;
    return [key, { delta: Math.round(delta), direction: delta >= 5 ? "up" : delta <= -5 ? "down" : "flat", verdict: delta >= 5 ? "Grow ho rahe ho" : delta <= -5 ? "Gir rahe ho" : "Barabar" }];
  }));
  const selectedDay = today;
  const selectedBlocks = getSchedule(selectedDay).filter(block => block.category !== "Review");
  const selectedLogs = (await query<LogRow>("SELECT block_id,status,reason FROM block_logs WHERE plan_day=$1", [selectedDay])).rows;
  const selectedStatus = new Map(selectedLogs.map(log => [log.block_id, log]));
  const completion = selectedBlocks.length ? Math.round(selectedBlocks.filter(block => selectedStatus.get(block.id)?.status === "done").length / selectedBlocks.length * 100) : 0;
  let streak = 0;
  let streakIndex = days.indexOf(today);
  if ((completionByDay.get(today) ?? 0) < 70) streakIndex -= 1;
  for (let i = streakIndex; i >= 0; i--) {
    if ((completionByDay.get(days[i]) ?? 0) >= 70) streak++;
    else break;
  }
  const nowParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(effectiveNow);
  const nowMinutes = Number(nowParts.find(p => p.type === "hour")?.value) * 60 + Number(nowParts.find(p => p.type === "minute")?.value) + (Number(nowParts.find(p => p.type === "hour")?.value) < 4 ? 1440 : 0);
  const previousPending = [...getSchedule(today)].reverse().filter(block => block.category !== "Review").find(block => {
    const end = block.end.split(":").map(Number).reduce((h, m) => h * 60 + m);
    return end <= nowMinutes && !selectedStatus.has(block.id);
  }) ?? null;
  const outbound = reviews.reduce((sum, row) => sum + Number((JSON.parse(row.answers_json) as Record<string, unknown>).outboundLeads || 0), 0);
  const medspa = reviews.reduce((sum, row) => sum + Number((JSON.parse(row.answers_json) as Record<string, unknown>).medspaLeads || 0), 0);
  const inbound = reviews.reduce((sum, row) => sum + Number((JSON.parse(row.answers_json) as Record<string, unknown>).linkedinInbound || 0), 0);
  const clientRows = reviews.filter(row => (JSON.parse(row.answers_json) as Record<string, unknown>).medspaClientsTotal !== undefined && (JSON.parse(row.answers_json) as Record<string, unknown>).medspaClientsTotal !== null);
  const clients = clientRows.length ? Number((JSON.parse(clientRows.at(-1)!.answers_json) as Record<string, unknown>).medspaClientsTotal) : 0;
  const mvp = [...reviews].reverse().find(row => Number((JSON.parse(row.answers_json) as Record<string, unknown>).startupProgress) >= 0);
  const mvpProgress = mvp ? Number((JSON.parse(mvp.answers_json) as Record<string, unknown>).startupProgress) : 0;
  const chart = days.filter(d => d <= today).map(day => ({ day, completion: completionByDay.get(day) ?? 0, scores: scoresByDay.get(day) ?? null }));
  return NextResponse.json({
    day: today,
    completion,
    streak,
    previousPending: previousPending ? { ...previousPending, status: null } : null,
    scores: latestDay ? scoresByDay.get(latestDay) : null,
    trends,
    goals: { outbound: { current: outbound, target: 300 }, medspa: { current: medspa, target: 560 }, clients: { current: clients, target: 1 }, linkedinInbound: { current: inbound }, startup: { current: mvpProgress } },
    chart,
    reviewComplete: reviewsByDay.has(today),
  });
}
