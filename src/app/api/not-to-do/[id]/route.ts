import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const rule = (await query<{ data_json: string }>("SELECT * FROM not_to_do_rules WHERE id=$1", [id])).rows[0];
  if (!rule) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  const [checkins, history] = await Promise.all([
    query("SELECT * FROM not_to_do_checkins WHERE rule_id=$1 ORDER BY checkin_date DESC", [id]),
    query("SELECT h.changed_at,h.previous_json FROM not_to_do_checkin_history h JOIN not_to_do_checkins c ON c.id=h.checkin_id WHERE c.rule_id=$1 ORDER BY h.changed_at DESC", [id]),
  ]);
  return NextResponse.json({ rule: { ...rule, data: JSON.parse(rule.data_json) }, checkins: checkins.rows, history: history.rows });
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid rule update." }, { status: 400 });
  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (key: string, value: unknown) => { values.push(value); fields.push(`${key}=$${values.length}`); };
  if (typeof body.title === "string" && body.title.trim()) set("title", body.title.trim().slice(0, 160));
  if (typeof body.category === "string" && body.category.trim()) set("category", body.category.trim());
  if (body.active === true || body.active === false) set("active", body.active ? 1 : 0);
  if (body.archived === true) set("archived_at", effectiveServerNow().toISOString());
  if (body.archived === false) set("archived_at", null);
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) set("data_json", JSON.stringify(body.data));
  set("updated_at", effectiveServerNow().toISOString());
  values.push(id);
  const result = await query(`UPDATE not_to_do_rules SET ${fields.join(",")} WHERE id=$${values.length}`, values);
  if (!result.rowCount) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
