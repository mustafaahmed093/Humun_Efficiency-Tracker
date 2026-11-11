import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: templateId } = await context.params;
  const body = await request.json().catch(() => null) as { date?: string; mode?: string } | null;
  if (!body?.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !["merge", "replace"].includes(String(body.mode))) {
    return NextResponse.json({ error: "Choose a valid date and explicitly choose merge or replace." }, { status: 400 });
  }
  const template = (await query<{ id: string }>("SELECT id FROM daily_templates WHERE id=$1", [templateId])).rows[0];
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const existing = (await query<{ id: string; status: string }>("SELECT id,status FROM daily_activities WHERE plan_date=$1", [body.date])).rows;
  if (body.mode === "replace" && existing.some(activity => activity.status !== "planned")) {
    return NextResponse.json({ error: "Executed history on this date is preserved; merge the template instead." }, { status: 409 });
  }
  const activities = (await query<{ title: string; start_time: string | null; end_time: string | null; category: string; priority: string; data_json: string; position: number }>(
    "SELECT title,start_time,end_time,category,priority,data_json,position FROM daily_template_activities WHERE template_id=$1 ORDER BY position,start_time", [templateId])).rows;
  if (!activities.length) return NextResponse.json({ error: "This template has no activities." }, { status: 400 });
  const now = effectiveServerNow().toISOString();
  await transaction(async client => {
    if (body.mode === "replace") await client.query("DELETE FROM daily_activities WHERE plan_date=$1", [body.date]);
    await client.query("INSERT INTO daily_plans (plan_date,source,data_json,created_at,updated_at) VALUES ($1,'template',$2,$3,$3) ON CONFLICT(plan_date) DO UPDATE SET source='template',updated_at=excluded.updated_at",
      [body.date, JSON.stringify({ templateId }), now]);
    const position = body.mode === "merge" ? existing.length : 0;
    for (const [index, activity] of activities.entries()) {
      await client.query(`INSERT INTO daily_activities (id,plan_date,title,start_time,end_time,category,priority,status,data_json,position,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',$8,$9,$10,$10)`,
      [randomUUID(), body.date, activity.title, activity.start_time, activity.end_time, activity.category, activity.priority, activity.data_json, position + index, now]);
    }
  });
  return NextResponse.json({ ok: true, applied: activities.length });
}
