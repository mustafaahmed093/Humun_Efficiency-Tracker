import { NextRequest, NextResponse } from "next/server";
import { devToolsEnabled, effectiveServerNow } from "@/lib/server-time";
import { planDayForDate } from "@/lib/schedule";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const now = effectiveServerNow();
  return NextResponse.json({ serverNow: now.toISOString(), planDay: planDayForDate(now), devTools: devToolsEnabled() });
}
