import { NextRequest, NextResponse } from "next/server";
import { isUnlocked, loginIpKey, passwordMatches, SESSION_COOKIE, setSessionCookie } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = loginIpKey(ip);
  const blocked = (await query<{ blocked: boolean }>("SELECT COALESCE(blocked_until > now(),false) AS blocked FROM login_attempts WHERE ip_key=$1", [ipKey])).rows[0]?.blocked;
  if (blocked) {
    return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }
  const body = await request.json().catch(() => null) as { pin?: string; password?: string } | null;
  const candidate = body?.password ?? body?.pin ?? "";
  if (!candidate || !passwordMatches(candidate)) {
    await query(`INSERT INTO login_attempts(ip_key,failures,window_started,blocked_until) VALUES($1,1,now(),null)
      ON CONFLICT(ip_key) DO UPDATE SET
        failures=CASE WHEN login_attempts.window_started < now()-interval '15 minutes' THEN 1 ELSE login_attempts.failures+1 END,
        window_started=CASE WHEN login_attempts.window_started < now()-interval '15 minutes' THEN now() ELSE login_attempts.window_started END,
        blocked_until=CASE WHEN login_attempts.window_started < now()-interval '15 minutes' THEN null
          WHEN login_attempts.failures+1 >= 8 THEN now()+interval '15 minutes' ELSE login_attempts.blocked_until END`, [ipKey]);
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

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
