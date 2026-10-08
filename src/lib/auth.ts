import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "cc_dev_session";
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function isValidSession(token?: string) {
  if (!token) return false;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;
  const expected = Buffer.from(signature(payload));
  const received = Buffer.from(mac);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  const [expires, nonce] = Buffer.from(payload, "base64url").toString().split(":");
  return Boolean(nonce) && Number(expires) > Date.now();
}

export function createSession() {
  const payload = Buffer.from(`${Date.now() + 12 * 60 * 60 * 1000}:${randomBytes(16).toString("hex")}`).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function setSessionCookie(response: NextResponse, token = createSession()) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
}

export function passwordMatches(candidate: string) {
  const configured = process.env.APP_PASSWORD;
  if (!configured || !/^\d{4}$/.test(configured)) throw new Error("APP_PASSWORD must be a 4-digit PIN.");
  const candidateHash = createHmac("sha256", secret()).update(candidate).digest();
  const configuredHash = createHmac("sha256", secret()).update(configured).digest();
  return timingSafeEqual(candidateHash, configuredHash);
}

export function loginIpKey(ip: string) {
  return createHmac("sha256", secret()).update(`login-ip:${ip}`).digest("hex");
}

export function isUnlocked(request: NextRequest) {
  return isValidSession(request.cookies.get(SESSION_COOKIE)?.value);
}
