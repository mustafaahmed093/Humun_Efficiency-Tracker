import { NextRequest, NextResponse } from "next/server";
import { writeDailyBackup } from "@/lib/backup";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  return NextResponse.json({ ok: true, ...await writeDailyBackup() }, { headers: { "Cache-Control": "no-store" } });
}
