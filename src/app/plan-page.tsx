"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { formatDay, getPlanDays, planEnd, planStart } from "@/lib/schedule";

type DayEntry = { plan_day: string; done: number; logged: number; scheduled: number; completion_pct: number };
type Review = { plan_day: string; answers: Record<string, unknown>; safety_count?: number; submitted_at: string | null; late_entry: boolean };
type Score = { plan_day: string; business?: number; health?: number; mental?: number; focus?: number; religious?: number; overall?: number };
type ExportData = { formatVersion: number; days: string[]; completion: DayEntry[]; reviews: Review[]; dailyScores: Score[]; goals: { plan_day: string; outbound_leads: number; outbound_target: number; medspa_leads: number; medspa_target: number; medspa_clients: number; client_target: number; linkedin_inbound: number; startup_progress: number }[]; crossedReasons: { plan_day: string; block: string; reason: string }[] };
type DevState = { enabled: boolean; simulatedNow: string | null };
const scoreKeys = ["business", "health", "mental", "focus", "religious", "overall"] as const;
const scoreLabels: Record<string, string> = { business: "Business", health: "Health", mental: "Mental", focus: "Focus", religious: "Religious", overall: "Overall" };
const sensitiveKeys = new Set(["mood", "stress", "stressNote", "tension", "happiness", "overthinkingCount", "focusRating"]);
const fullDays = getPlanDays();
function localInputValue(iso: string) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function completionColor(value: number, logged: number) { return !logged ? "empty" : value >= 80 ? "high" : value >= 50 ? "medium" : "low"; }
function reportRange(size: number, today: string) {
  if (size >= 15) return { from: fullDays[0], to: fullDays[14] };
  const end = fullDays.includes(today) ? today : fullDays[fullDays.length - 1];
  const endIndex = fullDays.indexOf(end);
  return { from: fullDays[Math.max(0, endIndex - size + 1)], to: end };
}

export default function PlanPage({ onNavigate, onDaySelect }: { onNavigate: (tab: string) => void; onDaySelect: (day: string) => void }) {
  const [data, setData] = useState<ExportData | null>(null);
  const [today, setToday] = useState(fullDays[0]);
  const [dev, setDev] = useState<DevState>({ enabled: false, simulatedNow: null });
  const [clockInput, setClockInput] = useState("");
  const [reportDays, setReportDays] = useState(3);
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = ["Dashboard", "Aaj", "Review", "Graphs", "15 Din"];
  const loadData = useCallback(async () => {
    const [dataResponse, clockResponse, devResponse] = await Promise.all([fetch("/api/export?includeSensitive=1", { cache: "no-store" }), fetch("/api/clock", { cache: "no-store" }), fetch("/api/dev-tools", { cache: "no-store" })]);
    if (dataResponse.ok) setData(await dataResponse.json() as ExportData);
    if (clockResponse.ok) {
      const clock = await clockResponse.json() as { serverNow: string; planDay: string };
      setToday(clock.planDay); setClockInput(localInputValue(clock.serverNow));
    }
    if (devResponse.ok) {
      const next = await devResponse.json() as DevState;
      setDev(next);
      if (next.simulatedNow) setClockInput(localInputValue(next.simulatedNow));
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData().catch(() => setMessage("Data load nahi hua. Dobara try karo.")); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);
  const completionMap = useMemo(() => new Map(data?.completion.map(item => [item.plan_day, item]) ?? []), [data]);
  const reviewMap = useMemo(() => new Map(data?.reviews.map(item => [item.plan_day, item]) ?? []), [data]);
  const currentRange = reportRange(reportDays, today);

  async function download(format: string, include = false) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/export?format=${format}&from=${planStart}&to=${planEnd}${include ? "&includeSensitive=1" : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Export nahi bana. Dobara try karo.");
      const blob = await response.blob(); const href = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = href; link.download = format === "ics" ? "command-center-15-day-plan.ics" : format === "json" ? "command-center-full-export.json" : `command-center-${currentRange.from}-to-${currentRange.to}.xlsx`;
      link.click(); URL.revokeObjectURL(href); setMessage(format.toUpperCase() + " download ho gaya.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Export nahi hua."); }
    finally { setBusy(false); }
  }

  function claudeSummary() {
    if (!data) return "";
    const days = data.days.filter(day => day >= currentRange.from && day <= currentRange.to);
    const scores = data.dailyScores.filter(row => row.plan_day <= currentRange.to);
    const last = scores.slice(-3); const previous = scores.slice(-6, -3);
    const trends = scoreKeys.map(key => {
      const mean = (rows: Score[]) => rows.length ? rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length : null;
      const a = mean(last); const b = mean(previous); const delta = a === null || b === null ? 0 : a - b;
      return `- ${scoreLabels[key]}: ${delta >= 5 ? "Grow ho rahe ho" : delta <= -5 ? "Gir rahe ho" : "Barabar"} (${delta >= 0 ? "+" : ""}${Math.round(delta)})`;
    }).join("\n");
    const reviewMap = new Map(data.reviews.map(review => [review.plan_day, review]));
    const completionMap = new Map(data.completion.map(item => [item.plan_day, item]));
    const scoreMap = new Map(data.dailyScores.map(item => [item.plan_day, item]));
    const goalMap = new Map(data.goals.map(item => [item.plan_day, item]));
    const daily = days.map(day => {
      const completion = completionMap.get(day); const score = scoreMap.get(day); const goals = goalMap.get(day); const review = reviewMap.get(day);
      const scoreLine = score ? scoreKeys.map(key => `${scoreLabels[key]} ${score[key] ?? 0}`).join(" · ") : "Scores pending";
      let answers = "";
      if (review?.answers) {
        const filtered = includeSensitive ? review.answers : Object.fromEntries(Object.entries(review.answers).filter(([key]) => !sensitiveKeys.has(key)));
        const parts = Object.entries(filtered).filter(([, value]) => value !== "" && value !== undefined && value !== null).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
        if (includeSensitive && review.safety_count !== undefined) parts.push(`safety_check_count: ${review.safety_count}`);
        answers = parts.length ? `\n  - Review: ${parts.join("; ")}` : "";
      }
      const missed = data.crossedReasons.filter(item => item.plan_day === day).map(item => `${item.block} (${item.reason})`).join(", ") || "None";
      return `### ${day}\n- Completion: ${completion?.completion_pct ?? 0}% (${completion?.done ?? 0}/${completion?.scheduled ?? 0})\n- ${scoreLine}\n- Goals cumulative: outbound ${goals?.outbound_leads ?? 0}/300; Medspa ${goals?.medspa_leads ?? 0}/560; clients ${goals?.medspa_clients ?? 0}/1; LinkedIn inbound ${goals?.linkedin_inbound ?? 0}; MVP ${goals?.startup_progress ?? 0}%\n- Crossed blocks: ${missed}${answers}`;
    }).join("\n\n");
    return `# Command Center · ${currentRange.from} to ${currentRange.to}\n\n## Trend verdicts (last 3 submitted days vs prior 3)\n${trends}\n\n## Daily log\n${daily || "No days in this range."}\n\nPlease analyze patterns, progress, and practical next steps. This is personal data; treat it privately.`;
  }

  async function copyReport() {
    try { await navigator.clipboard.writeText(claudeSummary()); setMessage("Report copy ho gaya. Ab Claude mein paste kar sakte ho."); }
    catch { setMessage("Clipboard access nahi mila. Browser permission check karo."); }
  }

  async function backupNow() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/backup", { method: "POST" });
      const result = await response.json() as { error?: string; saved?: string };
      if (!response.ok) throw new Error(result.error || "Backup nahi bana.");
      setMessage(`Private host backup saved: ${result.saved}`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Backup nahi bana."); }
    finally { setBusy(false); }
  }

  async function deleteAllData() {
    if (!window.confirm("Permanently delete all check-ins, reviews, and scores? An archive will be saved first. This cannot be undone.")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/data", { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Data delete nahi hua.");
      setMessage("All tracker data deleted. A last backup was kept on this host.");
      await loadData();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Data delete nahi hua."); }
    finally { setBusy(false); }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setMessage("");
    try {
      const parsed = JSON.parse(await file.text()) as ExportData;
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
      const result = await response.json() as { error?: string; imported?: { blocks: number; reviews: number; scores: number } };
      if (!response.ok) throw new Error(result.error || "Import failed.");
      setMessage(`Import ho gaya · ${result.imported?.blocks} blocks, ${result.imported?.reviews} reviews, ${result.imported?.scores} scores.`);
      await loadData();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "JSON file read nahi hui."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function devAction(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/dev-tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Dev action failed.");
      setMessage(action === "set-clock" ? "Simulated clock set ho gaya." : action === "clear-clock" ? "Real server clock restore ho gayi." : action === "load-demo" ? "Demo data load ho gaya." : action === "clear-demo" ? "Demo data clear ho gaya." : "Saara local data reset ho gaya.");
      window.dispatchEvent(new Event("cc-clock-changed"));
      await loadData();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Action nahi ho saka."); }
    finally { setBusy(false); }
  }

  const scoreMap = new Map(data?.dailyScores.map(score => [score.plan_day, score]) ?? []);
  return <PlanFrame nav={nav} onNavigate={onNavigate}><div className="plan-content"><div className="plan-heading"><div><p className="eyebrow">THE WHOLE JOURNEY · {formatDay(planStart)}–{formatDay(planEnd)} {planEnd.slice(0, 4)}</p><h1>15 din. Tumhara safar.</h1><p>Har din ek naya mauqa hai, peeche mud kar apni progress dekho.</p></div><div className="plan-count"><b>{data?.completion.filter(day => day.logged).length ?? 0}</b><span>days with logs</span></div></div>
    <section className="day-grid-card"><div className="grid-card-heading"><div><p className="eyebrow">YOUR PLAN AT A GLANCE</p><h2>Day-by-day progress</h2></div><span>DAY 01 — 15</span></div><div className="fifteen-day-grid">{fullDays.map((day,index)=>{ const entry=completionMap.get(day);const review=reviewMap.get(day);const performance=completionColor(entry?.completion_pct??0,entry?.logged??0);const future=day>today;const score=scoreMap.get(day)?.overall; return <button key={day} className={`plan-day-tile ${performance} ${future?"future":""}`} onClick={()=>{onDaySelect(day);onNavigate("Aaj");}}><span className="tile-day">DAY {String(index+1).padStart(2,"0")}</span><b>{day.split("-")[2]}</b><small>{formatDay(day).split(" ")[1]}</small><strong>{entry?.logged?`${entry.completion_pct}%`:future?"Soon":"—"}</strong><i className={review?.submitted_at?"review-check done":"review-check"}>{review?.submitted_at?"✓":"·"}</i>{score!==undefined&&<em>{score} overall</em>}</button>;})}</div><div className="performance-legend"><span><i className="high"/>80%+ Strong</span><span><i className="medium"/>50–79% Steady</span><span><i className="low"/>&lt;50% Needs care</span><span><i className="empty"/>No logs</span></div></section>
    <section className="exports-card"><div className="grid-card-heading"><div><p className="eyebrow">YOUR DATA, YOURS TO KEEP</p><h2>Export & reports</h2></div><span>Private · authenticated</span></div><div className="export-actions"><button onClick={()=>void download("xlsx")} disabled={busy}><span>▤</span><b>Export Excel</b><small>6 sheets · .xlsx</small><i>↓</i></button><button onClick={()=>void download("ics")} disabled={busy}><span>▦</span><b>Export Calendar</b><small>15-day schedule · .ics</small><i>↓</i></button><button onClick={()=>void download("json",true)} disabled={busy}><span>{"{}"}</span><b>Export JSON</b><small>Full data backup</small><i>↓</i></button><button onClick={()=>fileRef.current?.click()} disabled={busy}><span>↑</span><b>Import JSON</b><small>Merge a local backup</small><i>↑</i></button><input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={event=>void importFile(event)}/></div>
      <div className="claude-report"><div><p className="eyebrow">COPY A CLEAN SUMMARY</p><h3>Export for Claude</h3><p>Daily progress, scores, goals, missed blocks, and review answers.</p></div><div className="report-controls"><button className={reportDays===3?"active":""} onClick={()=>setReportDays(3)}>3 days</button><button className={reportDays===7?"active":""} onClick={()=>setReportDays(7)}>7 days</button><button className={reportDays===15?"active":""} onClick={()=>setReportDays(15)}>Full plan</button><label><input type="checkbox" checked={includeSensitive} onChange={event=>setIncludeSensitive(event.target.checked)}/> Include safety count & mental-health fields</label><button className="copy-report-button" onClick={()=>void copyReport()} disabled={!data}>Copy summary <span>⧉</span></button></div></div>
    </section>
    <section className="devtools-card"><div className="grid-card-heading"><div><p className="eyebrow">PRIVACY & RECOVERY</p><h2>Keep or remove your data</h2></div><span>Stored on this app host</span></div><p>Daily snapshots keep up to 14 JSON backups in the local data/backups folder. Your host needs persistent disk storage for these backups to survive restarts.</p><div className="dev-data-actions"><button onClick={()=>void backupNow()} disabled={busy}>Save backup now</button><button className="danger-dev" onClick={()=>void deleteAllData()} disabled={busy}>Delete all my data</button></div></section>
    {message&&<div className="plan-toast">{message}<button onClick={()=>setMessage("")}>×</button></div>}
    {dev.enabled&&<section className="devtools-card"><div className="grid-card-heading"><div><p className="eyebrow">LOCAL DEVELOPMENT ONLY</p><h2>Dev tools</h2></div><span>Clock override never runs in production</span></div><div className="sim-clock-row"><label>Simulated Karachi date & time<input type="datetime-local" value={clockInput} onChange={event=>setClockInput(event.target.value)}/></label><button onClick={()=>void devAction("set-clock",{localDateTime:clockInput})} disabled={busy||!clockInput}>Set simulated clock</button><button className="secondary-dev" onClick={()=>void devAction("clear-clock")} disabled={busy}>Use real time</button><span>{dev.simulatedNow?`Simulated · ${formatDay(today)}`:"Using server time"}</span></div><div className="dev-data-actions"><button onClick={()=>void devAction("load-demo")} disabled={busy}>Load demo data</button><button onClick={()=>void devAction("clear-demo")} disabled={busy}>Clear demo data</button><button className="danger-dev" onClick={()=>{if(window.confirm("Reset all local reviews, scores, and schedule check-ins? This cannot be undone."))void devAction("reset-all");}} disabled={busy}>Reset all data</button></div><p>Use the clock to test the 00:30 review unlock, 04:00 day boundary, and Abhi block. Demo rows are tagged separately; clearing demo preserves real entries.</p></section>}
    <footer className="page-footer"><span>MADE FOR YOUR NEXT CHAPTER</span><span>YOUR DATA STAYS PRIVATE <i>✦</i></span></footer></div></PlanFrame>;
}

function PlanFrame({children,nav,onNavigate}:{children:React.ReactNode;nav:string[];onNavigate:(tab:string)=>void}){return <main className="plan-app"><header className="dash-top"><div className="dash-brand">✦ <b>command<span>center</span></b></div><nav>{nav.map((tab,index)=><button key={tab} className={tab==="15 Din"?"selected":""} onClick={()=>onNavigate(tab)}><span>{["◫","◷","☾","⌁","▦"][index]}</span>{tab}</button>)}</nav><div className="dash-user"><span className="avatar">M</span><span><b>Mustafa</b><small>KARACHI · PKT</small></span></div></header>{children}</main>;}
