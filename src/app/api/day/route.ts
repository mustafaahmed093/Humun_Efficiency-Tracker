import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSchedule, planStart, planEnd } from "@/lib/schedule";
import { effectiveServerNow } from "@/lib/server-time";
import { tryWriteDailyBackup } from "@/lib/backup";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validDay(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= planStart && day <= planEnd; }

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const day = request.nextUrl.searchParams.get("date") ?? planStart;
  if (!validDay(day)) return NextResponse.json({ error: "Day is outside the 15-day plan." }, { status: 400 });
  const stored = (await query("SELECT block_id as id, plan_day as day, status, reason, updated_at as \"updatedAt\" FROM block_logs WHERE plan_day=$1", [day])).rows;
  const blocks = (await query("SELECT id, start_time as start, end_time as end, name, category, prayer FROM schedule_blocks WHERE plan_day=$1 ORDER BY start_time", [day])).rows;
  return NextResponse.json({ day, blocks: blocks.length ? blocks : getSchedule(day), logs: stored });
}

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as { day?: string; blockId?: string; status?: string; reason?: string | null } | null;
  if (!body || !body.day || !validDay(body.day) || !body.blockId || !["done", "missed"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "Invalid block update." }, { status: 400 });
  }
  if (body.status === "missed" && !body.reason?.trim()) return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  const known = (await query("SELECT id FROM schedule_blocks WHERE id=$1 AND plan_day=$2", [body.blockId, body.day])).rows[0];
  if (!known) return NextResponse.json({ error: "Unknown schedule block." }, { status: 404 });
  await query(`INSERT INTO block_logs (block_id,plan_day,status,reason,updated_at,is_demo) VALUES ($1,$2,$3,$4,$5,0)
    ON CONFLICT(block_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, updated_at=excluded.updated_at,is_demo=0`,
  [body.blockId, body.day, body.status, body.status === "missed" ? body.reason!.trim() : null, effectiveServerNow().toISOString()]);
  await tryWriteDailyBackup();
  return NextResponse.json({ ok: true });
}
