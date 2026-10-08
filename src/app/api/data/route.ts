import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { writeDailyBackup } from "@/lib/backup";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export async function DELETE(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  await writeDailyBackup();
  await transaction(async client => {
    await client.query("DELETE FROM block_logs; DELETE FROM nightly_reviews; DELETE FROM daily_scores; DELETE FROM settings WHERE key='simulated_now'; UPDATE settings SET value='false' WHERE key='late_entry_enabled'");
  });
  return NextResponse.json({ ok: true });
}
