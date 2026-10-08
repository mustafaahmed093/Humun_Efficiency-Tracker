import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getSchedule } from "@/lib/schedule";
import { calculateScores } from "@/lib/scoring";
import { devToolsEnabled, setSimulatedNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
const reasons = ["Overthinking", "Neend / Thakan", "Phone / Distraction", "Family", "Tabiyat", "Lazy feel hua"];

function allowed(request: NextRequest) {
  return isUnlocked(request) && devToolsEnabled();
}

async function clearDemo() {
  await transaction(async client => {
    await client.query("DELETE FROM block_logs WHERE is_demo=1; DELETE FROM nightly_reviews WHERE is_demo=1; DELETE FROM daily_scores WHERE is_demo=1");
  });
}

async function makeDemoData() {
  await transaction(async client => {
  await client.query("DELETE FROM block_logs WHERE is_demo=1; DELETE FROM nightly_reviews WHERE is_demo=1; DELETE FROM daily_scores WHERE is_demo=1");
  const blockInsert = "INSERT INTO block_logs (block_id,plan_day,status,reason,updated_at,is_demo) VALUES ($1,$2,$3,$4,$5,1) ON CONFLICT(block_id) DO NOTHING";
  const reviewInsert = "INSERT INTO nightly_reviews (plan_day,answers_json,safety_count,draft_updated_at,submitted_at,late_entry,is_demo) VALUES ($1,$2,0,$3,$4,0,1) ON CONFLICT(plan_day) DO NOTHING";
  const scoreInsert = "INSERT INTO daily_scores (plan_day,scores_json,created_at,is_demo) VALUES ($1,$2,$3,1) ON CONFLICT(plan_day) DO NOTHING";
  for (let dayIndex = 0; dayIndex < 15; dayIndex++) {
    const day = new Date(Date.UTC(2026, 9, 7 + dayIndex)).toISOString().slice(0, 10);
    const schedule = getSchedule(day).filter(block => block.category !== "Review");
    for (let index = 0; index < schedule.length; index++) {
      const block = schedule[index];
      const isDone = ((dayIndex * 7 + index * 3) % 10) < (dayIndex < 4 ? 6 : dayIndex < 10 ? 8 : 7);
      await client.query(blockInsert, [block.id, day, isDone ? "done" : "missed", isDone ? null : reasons[(dayIndex + index) % reasons.length], `${day}T18:00:00.000Z`]);
    }
    const saved = (await client.query<{ block_id: string; status: "done" | "missed"; reason: string | null }>("SELECT block_id,status,reason FROM block_logs WHERE plan_day=$1", [day])).rows;
    const status = new Map(saved.map(row => [row.block_id, row]));
    const prayers = Object.fromEntries(["Fajr", "Zohr", "Asr", "Maghrib", "Isha"].map(name => {
      const linked = schedule.find(block => block.prayer === name);
      const linkedStatus = linked ? status.get(linked.id)?.status : undefined;
      return [name, linkedStatus ? linkedStatus === "done" : ((dayIndex + name.length) % 4 !== 0)];
    }));
    const answers = {
      dailyWork: `Demo reflection for ${day}: focused work and a few small wins.`, biggestAchievement: dayIndex % 3 === 0 ? "Finished a focused work block" : "Kept the routine moving",
      selfFeedback: "Keep the next step small and clear.", prayers, dailyLecture: status.get(schedule.find(block => block.name.includes("Dr Nauman"))?.id ?? "")?.status === "done",
      outboundLeads: 13 + dayIndex % 11, outboundReplies: 2 + dayIndex % 5, outboundCalls: dayIndex % 3,
      medspaLeads: 28 + dayIndex % 15, medspaReplies: 4 + dayIndex % 6, medspaCalls: dayIndex % 4, medspaConverted: dayIndex === 11 ? 1 : 0, medspaNotConverted: 2 + dayIndex % 3,
      medspaNotConvertedReason: "Follow-up pending", medspaClientsTotal: dayIndex >= 11 ? 1 : 0,
      linkedinSent: 10 + dayIndex % 8, linkedinInbound: dayIndex % 3, linkedinPosts: dayIndex % 2,
      startupProgress: Math.min(92, 8 + dayIndex * 5), startupMoved: "Moved one small MVP task forward.",
      classesAttended: dayIndex % 2 ? 2 : 0, uniEffort: dayIndex % 2 ? 7 : 5, uniActivity: "Reviewed notes",
      japanWorked: dayIndex % 3 === 0, japanNote: "Checked the next steps.",
      mood: (["Guzara", "Productive", "Guzara", "Sad"] as const)[dayIndex % 4], stress: (["Thoda", "Nahi", "Thoda"] as const)[dayIndex % 3],
      stressNote: "Demo only", tension: "Demo reflection", happiness: "Family time", overthinkingCount: dayIndex % 4, focusRating: 6 + dayIndex % 5,
      mealBreakfast: "Eggs and toast", mealLunch: "Rice and chicken", mealDinner: dayIndex % 4 ? "Daal" : "", waterGlasses: 6 + dayIndex % 4,
      sleepHours: 6 + dayIndex % 3, exerciseDone: schedule.some(block => block.name.toLowerCase().includes("exercise") && status.get(block.id)?.status === "done"),
      walkDone: schedule.some(block => block.name.toLowerCase().includes("meditation / walk") && status.get(block.id)?.status === "done"),
      familyMinutes: 25 + (dayIndex % 5) * 10, missedReasons: "Demo entries are synthetic.",
    };
    const submittedAt = `${day}T20:30:00.000Z`;
    await client.query(reviewInsert, [day, JSON.stringify(answers), submittedAt, submittedAt]);
    const scoreBlocks = schedule.map(block => ({ category: block.category, name: block.name, status: status.get(block.id)?.status ?? null }));
    const scores = calculateScores({ ...answers, meals: [answers.mealBreakfast, answers.mealLunch, answers.mealDinner] }, scoreBlocks);
    await client.query(scoreInsert, [day, JSON.stringify(scores), submittedAt]);
  }
  });
  return { days: 15 };
}

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const simulatedNow = (await query<{ value: string }>("SELECT value FROM settings WHERE key='simulated_now'")).rows[0]?.value ?? null;
  if (simulatedNow) setSimulatedNow(simulatedNow);
  return NextResponse.json({ enabled: devToolsEnabled(), simulatedNow });
}

export async function POST(request: NextRequest) {
  if (!allowed(request)) return NextResponse.json({ error: "Development tools are unavailable." }, { status: 404 });
  const body = await request.json().catch(() => null) as { action?: string; localDateTime?: string } | null;
  if (body?.action === "set-clock") {
    if (!body.localDateTime || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.localDateTime)) return NextResponse.json({ error: "Date and time format is invalid." }, { status: 400 });
    const simulated = new Date(`${body.localDateTime}:00+05:00`);
    if (Number.isNaN(simulated.getTime())) return NextResponse.json({ error: "Date and time is invalid." }, { status: 400 });
    await query("INSERT INTO settings (key,value) VALUES ('simulated_now',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [simulated.toISOString()]);
    setSimulatedNow(simulated.toISOString());
    return NextResponse.json({ ok: true, simulatedNow: simulated.toISOString() });
  }
  if (body?.action === "clear-clock") {
    await query("DELETE FROM settings WHERE key='simulated_now'");
    setSimulatedNow(null);
    return NextResponse.json({ ok: true, simulatedNow: null });
  }
  if (body?.action === "load-demo") return NextResponse.json({ ok: true, ...await makeDemoData() });
  if (body?.action === "clear-demo") { await clearDemo(); return NextResponse.json({ ok: true }); }
  if (body?.action === "reset-all") {
    await transaction(async client => { await client.query("DELETE FROM block_logs; DELETE FROM nightly_reviews; DELETE FROM daily_scores; DELETE FROM settings WHERE key='simulated_now'; UPDATE settings SET value='false' WHERE key='late_entry_enabled'"); });
    setSimulatedNow(null);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown development action." }, { status: 400 });
}
