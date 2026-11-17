import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";
import { addPlannerDays } from "@/lib/planner";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: templateId } = await context.params;
  const body = await request.json().catch(() => null) as { date?: string; mode?: string } | null;
  if (!body || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !["merge", "replace"].includes(String(body.mode))) {
    return NextResponse.json({ error: "Choose a valid date and explicitly choose merge or replace." }, { status: 400 });
  }
  const planDate = body.date;
  const template = (await query<{ id: string }>("SELECT id FROM daily_templates WHERE id=$1", [templateId])).rows[0];
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const existing = (await query<{ id: string; title: string; start_time: string | null; end_time: string | null; category: string; goal_id: string | null; status: string }>(
    "SELECT id,title,start_time,end_time,category,goal_id,status FROM daily_activities WHERE plan_date=$1", [planDate])).rows;
  if (body.mode === "replace" && existing.some(activity => activity.status !== "planned")) {
    return NextResponse.json({ error: "Executed history on this date is preserved; merge the template instead." }, { status: 409 });
  }
  const activities = (await query<{ title: string; start_time: string | null; end_time: string | null; category: string; priority: string; goal_id: string | null; milestone_id: string | null; data_json: string; position: number }>(
    "SELECT title,start_time,end_time,category,priority,goal_id,milestone_id,data_json,position FROM daily_template_activities WHERE template_id=$1 ORDER BY position,start_time", [templateId])).rows;
  if (!activities.length) return NextResponse.json({ error: "This template has no activities." }, { status: 400 });
  const now = effectiveServerNow().toISOString();
  let applied = 0;
  await transaction(async client => {
    if (body.mode === "replace") await client.query("DELETE FROM daily_activities WHERE plan_date=$1", [planDate]);
    await client.query("INSERT INTO daily_plans (plan_date,source,data_json,created_at,updated_at) VALUES ($1,'template',$2,$3,$3) ON CONFLICT(plan_date) DO UPDATE SET source='template',updated_at=excluded.updated_at",
      [planDate, JSON.stringify({ templateId }), now]);
    const position = body.mode === "merge" ? existing.length : 0;
    let added = 0;
    for (const activity of activities) {
      if (body.mode === "merge" && existing.some(item => item.title === activity.title && item.start_time === activity.start_time &&
        item.end_time === activity.end_time && item.category === activity.category && item.goal_id === activity.goal_id)) continue;
      const data = JSON.parse(activity.data_json) as Record<string, unknown>;
      if (Number.isInteger(data.endDayOffset)) {
        const endDate = addPlannerDays(planDate, Number(data.endDayOffset));
        if (endDate) data.endDate = endDate;
        delete data.endDayOffset;
      } else if (typeof data.endDate === "string" && data.endDate < planDate) {
        data.endDate = planDate;
      }
      await client.query(`INSERT INTO daily_activities (id,plan_date,title,start_time,end_time,category,priority,goal_id,milestone_id,status,data_json,position,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planned',$10,$11,$12,$12)`,
      [randomUUID(), planDate, activity.title, activity.start_time, activity.end_time, activity.category, activity.priority,
        activity.goal_id, activity.milestone_id, JSON.stringify(data), position + added, now]);
      added++;
    }
    applied = added;
  });
  return NextResponse.json({ ok: true, applied });
}
