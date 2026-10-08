import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { getPlanDays, getSchedule, planEnd, planStart } from "@/lib/schedule";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type LogRow = { block_id: string; plan_day: string; status: string; reason: string | null; updated_at: string };
type ReviewRow = { plan_day: string; answers_json: string; safety_count: number; draft_updated_at: string; submitted_at: string | null; late_entry: number };
type ScoreRow = { plan_day: string; scores_json: string; created_at: string };
const mentalFields = new Set(["mood", "stress", "stressNote", "tension", "happiness", "overthinkingCount", "focusRating"]);

function validRange(from: string, to: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
}
function escapeIcs(text: string) { return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function eventDate(day: string, time: string) {
  const total = time.split(":").map(Number).reduce((h, m) => h * 60 + m);
  const normalizedDay = new Date(new Date(`${day}T00:00:00Z`).getTime() + Math.floor(total / 1440) * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
  const minute = total % 1440;
  return `${normalizedDay}T${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}00`;
}

function makeCalendar(now: Date) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Command Center//15 Day Plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VTIMEZONE", "TZID:Asia/Karachi", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0500", "TZOFFSETTO:+0500", "TZNAME:PKT", "END:STANDARD", "END:VTIMEZONE"];
  for (const day of getPlanDays()) {
    for (const block of getSchedule(day)) {
      lines.push("BEGIN:VEVENT", `UID:${block.id}@command-center.local`, `DTSTAMP:${stamp}`, `DTSTART;TZID=Asia/Karachi:${eventDate(day, block.start)}`, `DTEND;TZID=Asia/Karachi:${eventDate(day, block.end)}`, `SUMMARY:${escapeIcs(block.name)}`, `CATEGORIES:${escapeIcs(block.category)}`, "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcs(block.name)}`, "END:VALARM", "END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export async function collect(from: string, to: string, includeSensitive: boolean) {
  const days = getPlanDays().filter(day => day >= from && day <= to);
  const logs = (await query<LogRow>("SELECT block_id,plan_day,status,reason,updated_at FROM block_logs WHERE plan_day BETWEEN $1 AND $2 ORDER BY plan_day,updated_at", [from, to])).rows;
  const logMap = new Map(logs.map(log => [log.block_id, log]));
  const scheduleLog = days.flatMap(day => getSchedule(day).map(block => {
    const log = logMap.get(block.id);
    return { plan_day: day, block_id: block.id, start: block.start, end: block.end, block: block.name, category: block.category, prayer: block.prayer ?? "", status: log?.status ?? "pending", reason: log?.reason ?? "", updated_at: log?.updated_at ?? "" };
  }));
  const reviewRows = (await query<ReviewRow>("SELECT plan_day,answers_json,safety_count,draft_updated_at,submitted_at,late_entry FROM nightly_reviews WHERE plan_day BETWEEN $1 AND $2 ORDER BY plan_day", [from, to])).rows;
  const reviews = reviewRows.map(row => {
    const answers = JSON.parse(row.answers_json) as Record<string, unknown>;
    const filtered = includeSensitive ? answers : Object.fromEntries(Object.entries(answers).filter(([key]) => !mentalFields.has(key)));
    return { plan_day: row.plan_day, answers: filtered, safety_count: includeSensitive ? row.safety_count : undefined, draft_updated_at: row.draft_updated_at, submitted_at: row.submitted_at, late_entry: Boolean(row.late_entry) };
  });
  const scoreRows = (await query<ScoreRow>("SELECT plan_day,scores_json,created_at FROM daily_scores WHERE plan_day BETWEEN $1 AND $2 ORDER BY plan_day", [from, to])).rows;
  const dailyScores = scoreRows.map(row => ({ plan_day: row.plan_day, ...JSON.parse(row.scores_json) as Record<string, number>, created_at: row.created_at }));
  let outbound = 0; let medspa = 0; let inbound = 0; let clients = 0; let startup = 0;
  const answerByDay = new Map(reviewRows.filter(row => row.submitted_at).map(row => [row.plan_day, JSON.parse(row.answers_json) as Record<string, unknown>]));
  const goals = days.map(day => {
    const answers = answerByDay.get(day);
    if (answers) {
      outbound += Number(answers.outboundLeads || 0); medspa += Number(answers.medspaLeads || 0); inbound += Number(answers.linkedinInbound || 0);
      if (answers.medspaClientsTotal !== undefined) clients = Number(answers.medspaClientsTotal || 0);
      if (answers.startupProgress !== undefined) startup = Number(answers.startupProgress || 0);
    }
    return { plan_day: day, outbound_leads: outbound, outbound_target: 300, medspa_leads: medspa, medspa_target: 560, medspa_clients: clients, client_target: 1, linkedin_inbound: inbound, startup_progress: startup };
  });
  const prayers = days.flatMap(day => prayerNames.map(name => {
    const answer = answerByDay.get(day)?.prayers as Record<string, boolean | null> | undefined;
    const linked = getSchedule(day).find(block => block.prayer === name);
    const status = answer && typeof answer[name] === "boolean" ? answer[name] ? "done" : "missed" : linked ? logMap.get(linked.id)?.status ?? "pending" : "unlogged";
    return { plan_day: day, prayer: name, status };
  }));
  const crossedReasons = logs.filter(log => log.status === "missed").map(log => ({ plan_day: log.plan_day, block: getSchedule(log.plan_day).find(block => block.id === log.block_id)?.name ?? log.block_id, reason: log.reason ?? "" }));
  const completion = days.map(day => {
    const countable = getSchedule(day).filter(block => block.category !== "Review");
    const logged = countable.filter(block => logMap.has(block.id)).length;
    const complete = countable.filter(block => logMap.get(block.id)?.status === "done").length;
    return { plan_day: day, done: complete, logged, scheduled: countable.length, completion_pct: countable.length ? Math.round(complete / countable.length * 100) : 0 };
  });
  return { formatVersion: 1, range: { from, to }, days, scheduleLog, reviews, dailyScores, goals, prayers, crossedReasons, completion };
}

const prayerNames = ["Fajr", "Zohr", "Asr", "Maghrib", "Isha"];

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const query = request.nextUrl.searchParams;
  const format = query.get("format") ?? "json";
  const from = query.get("from") ?? planStart;
  const to = query.get("to") ?? planEnd;
  if (!validRange(from, to) || from < planStart || to > planEnd) return NextResponse.json({ error: "Export date range is outside the plan." }, { status: 400 });
  if (format === "ics") {
    return new NextResponse(makeCalendar(effectiveServerNow()), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "attachment; filename=command-center-15-day-plan.ics", "Cache-Control": "no-store" } });
  }
  const data = await collect(from, to, query.get("includeSensitive") === "1");
  if (format === "json") return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  if (format !== "xlsx") return NextResponse.json({ error: "Unsupported export format." }, { status: 400 });
  const workbook = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: "No data in this range" }]), name);
  add("Schedule_Log", data.scheduleLog);
  add("Nightly_Review", data.reviews.map(row => ({ plan_day: row.plan_day, ...row.answers, safety_count: row.safety_count ?? "", submitted_at: row.submitted_at ?? "", late_entry: row.late_entry, draft_updated_at: row.draft_updated_at })));
  add("Daily_Scores", data.dailyScores);
  add("Goals_Cumulative", data.goals);
  add("Prayers", data.prayers);
  add("Crossed_Reasons", data.crossedReasons);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename=command-center-${from}-to-${to}.xlsx`, "Cache-Control": "no-store" } });
}
