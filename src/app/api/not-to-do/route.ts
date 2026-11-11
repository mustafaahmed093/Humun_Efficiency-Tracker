import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { calculateAvoidanceMetrics, type HabitOutcome } from "@/lib/life-system";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RuleRow = { id: string; title: string; category: string; start_date: string; active: number; archived_at: string | null; data_json: string };

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const rules = (await query<RuleRow>(`SELECT * FROM not_to_do_rules ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY active DESC,created_at DESC`)).rows;
  const result = await Promise.all(rules.map(async rule => {
    const checkins = (await query<{ checkin_date: string; outcome: HabitOutcome; urges: number }>(
      "SELECT checkin_date,outcome,urges FROM not_to_do_checkins WHERE rule_id=$1 ORDER BY checkin_date", [rule.id])).rows;
    return {
      ...rule,
      active: Boolean(rule.active),
      data: JSON.parse(rule.data_json),
      checkins,
      metrics: calculateAvoidanceMetrics(checkins,
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(effectiveServerNow())),
    };
  }));
  return NextResponse.json({ rules: result });
}

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string" || !body.title.trim() || typeof body.category !== "string" || !body.category.trim()) {
    return NextResponse.json({ error: "Habit name and category are required." }, { status: 400 });
  }
  const now = effectiveServerNow().toISOString();
  const startDate = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : now.slice(0, 10);
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  const id = randomUUID();
  await query(`INSERT INTO not_to_do_rules (id,title,category,start_date,active,data_json,created_at,updated_at)
    VALUES ($1,$2,$3,$4,1,$5,$6,$6)`,
  [id, body.title.trim().slice(0, 160), body.category.trim(), startDate, JSON.stringify(data), now]);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
