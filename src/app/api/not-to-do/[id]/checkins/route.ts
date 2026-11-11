import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const outcomes = ["avoided", "urge_resisted", "slip", "not_applicable"];

export async function GET(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const checkins = await query("SELECT * FROM not_to_do_checkins WHERE rule_id=$1 ORDER BY checkin_date DESC", [id]);
  return NextResponse.json({ checkins: checkins.rows.map(row => ({ ...row, data: JSON.parse(String(row.data_json)) })) });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: ruleId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      typeof body.outcome !== "string" || !outcomes.includes(body.outcome)) {
    return NextResponse.json({ error: "A valid date and check-in outcome are required." }, { status: 400 });
  }
  const urges = body.urges === undefined ? 0 : Number(body.urges);
  const intensity = body.intensity === undefined || body.intensity === null ? null : Number(body.intensity);
  if (!Number.isInteger(urges) || urges < 0 || urges > 1000 ||
      (intensity !== null && (!Number.isInteger(intensity) || intensity < 1 || intensity > 10))) {
    return NextResponse.json({ error: "Urges or intensity is outside the allowed range." }, { status: 400 });
  }
  const now = effectiveServerNow().toISOString();
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  const id = randomUUID();
  const result = await transaction(async client => {
    const rule = (await client.query<{ id: string }>("SELECT id FROM not_to_do_rules WHERE id=$1 AND archived_at IS NULL", [ruleId])).rows[0];
    if (!rule) return { error: "Active rule not found." };
    const existing = (await client.query<{ id: string; checkin_date: string; outcome: string; urges: number; intensity: number | null; data_json: string }>(
      "SELECT id,checkin_date,outcome,urges,intensity,data_json FROM not_to_do_checkins WHERE rule_id=$1 AND checkin_date=$2", [ruleId, body.date])).rows[0];
    const checkinId = existing?.id ?? id;
    if (existing) {
      await client.query("INSERT INTO not_to_do_checkin_history (id,checkin_id,previous_json,changed_at) VALUES ($1,$2,$3,$4)",
        [randomUUID(), existing.id, JSON.stringify(existing), now]);
    }
    await client.query(`INSERT INTO not_to_do_checkins (id,rule_id,checkin_date,outcome,urges,intensity,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
      ON CONFLICT(rule_id,checkin_date) DO UPDATE SET outcome=excluded.outcome,urges=excluded.urges,
        intensity=excluded.intensity,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [checkinId, ruleId, body.date, body.outcome, urges, intensity, JSON.stringify(data), now]);
    return { id: checkinId, updated: Boolean(existing) };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, ...result }, { status: result.updated ? 200 : 201 });
}
