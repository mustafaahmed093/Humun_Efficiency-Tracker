import { NextRequest, NextResponse } from "next/server";
import { isUnlocked, loginIpKey, passwordMatches, SESSION_COOKIE, setSessionCookie } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = loginIpKey(ip);
  const blockedUntil = (await query<{ blocked_until: Date | string | null }>("SELECT blocked_until FROM login_attempts WHERE ip_key=$1", [ipKey])).rows[0]?.blocked_until;
  if (blockedUntil && new Date(blockedUntil).getTime() > Date.now()) {
    return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }
  const body = await request.json().catch(() => null) as { pin?: string; password?: string } | null;
  const candidate = body?.password ?? body?.pin ?? "";
  if (!candidate || !passwordMatches(candidate)) {
    const now = new Date();
    const windowStarted = now.toISOString();
    const windowExpiredBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const blockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    await query(`INSERT INTO login_attempts(ip_key,failures,window_started,blocked_until) VALUES($1,1,$2,null)
      ON CONFLICT(ip_key) DO UPDATE SET
        failures=CASE WHEN login_attempts.window_started < $3 THEN 1 ELSE login_attempts.failures+1 END,
        window_started=CASE WHEN login_attempts.window_started < $3 THEN $2 ELSE login_attempts.window_started END,
        blocked_until=CASE WHEN login_attempts.window_started < $3 THEN null
          WHEN login_attempts.failures+1 >= 8 THEN $4 ELSE login_attempts.blocked_until END`, [ipKey, windowStarted, windowExpiredBefore, blockedUntil]);
    return NextResponse.json({ error: "Password sahi nahi hai." }, { status: 401 });
  }
  await query("DELETE FROM login_attempts WHERE ip_key=$1", [ipKey]);
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response);
  return response;
}

export async function PUT(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
