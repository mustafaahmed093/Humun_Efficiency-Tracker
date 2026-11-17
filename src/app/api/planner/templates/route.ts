import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const templates = await query<{ id: string; title: string; description: string | null; data_json: string; created_at: string }>(
    "SELECT * FROM daily_templates ORDER BY updated_at DESC");
  const result = await Promise.all(templates.rows.map(async template => {
    const activities = await query("SELECT * FROM daily_template_activities WHERE template_id=$1 ORDER BY position,start_time", [template.id]);
    return { ...template, data: JSON.parse(template.data_json), activities: activities.rows.map(row => ({ ...row, data: JSON.parse(String(row.data_json)) })) };
  }));
  return NextResponse.json({ templates: result });
}

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as { title?: string; description?: string; date?: string } | null;
  if (!body?.title?.trim() || !body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: "Template title and source plan date are required." }, { status: 400 });
  }
  const source = (await query<{ id: string; title: string; start_time: string | null; end_time: string | null; category: string; priority: string; goal_id: string | null; milestone_id: string | null; data_json: string; position: number }>(
    "SELECT id,title,start_time,end_time,category,priority,goal_id,milestone_id,data_json,position FROM daily_activities WHERE plan_date=$1 ORDER BY position,start_time", [body.date])).rows;
  if (!source.length) return NextResponse.json({ error: "Add at least one activity to that date before saving a template." }, { status: 400 });
  const id = randomUUID();
  const now = effectiveServerNow().toISOString();
  await transaction(async client => {
    await client.query("INSERT INTO daily_templates (id,title,description,data_json,created_at,updated_at) VALUES ($1,$2,$3,'{}',$4,$4)",
      [id, body.title!.trim().slice(0, 120), body.description ?? null, now]);
    for (const [position, activity] of source.entries()) {
        const data = JSON.parse(activity.data_json) as Record<string, unknown>;
        if (typeof data.endDate === "string") {
          data.endDayOffset = Math.max(0, (Date.parse(`${data.endDate}T00:00:00Z`) - Date.parse(`${body.date}T00:00:00Z`)) / 86_400_000);
          delete data.endDate;
        }
        await client.query(`INSERT INTO daily_template_activities
          (id,template_id,title,start_time,end_time,category,priority,goal_id,milestone_id,data_json,position)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [randomUUID(), id, activity.title, activity.start_time, activity.end_time, activity.category, activity.priority,
          activity.goal_id, activity.milestone_id, JSON.stringify(data), position]);
    }
  });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Template id is required." }, { status: 400 });
  const result = await query("DELETE FROM daily_templates WHERE id=$1", [id]);
  if (!result.rowCount) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
