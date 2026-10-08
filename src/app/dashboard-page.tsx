"use client";

import { useEffect, useMemo, useState } from "react";
import { getSchedule, formatDay, weekdayName } from "@/lib/schedule";

type Trend = { delta: number; direction: "up" | "down" | "flat"; verdict: string };
type Data = {
  day: string;
  completion: number;
  streak: number;
  previousPending: { name: string } | null;
  scores: Record<string, number> | null;
  trends: Record<string, Trend>;
  goals: { outbound: { current: number; target: number }; medspa: { current: number; target: number }; clients: { current: number; target: number }; linkedinInbound: { current: number }; startup: { current: number } };
  reviewComplete: boolean;
};

const scoreNames: Record<string, string> = { business: "Business", health: "Health", mental: "Mental", focus: "Focus", religious: "Religious", overall: "Overall" };
const scoreColors: Record<string, string> = { business: "#5683dc", health: "#df9854", mental: "#d77a9b", focus: "#8170d8", religious: "#4e9b76", overall: "#376e50" };

function currentScheduleInfo(day: string, now: Date) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  let minutes = local.getHours() * 60 + local.getMinutes();
  if (local.getHours() < 4) minutes += 1440;
  const blocks = getSchedule(day).filter(block => block.category !== "Review");
  const current = blocks.find(block => {
    const [sh, sm] = block.start.split(":").map(Number); const [eh, em] = block.end.split(":").map(Number);
    return minutes >= sh * 60 + sm && minutes < eh * 60 + em;
  });
  const upcoming = current ? blocks[blocks.indexOf(current) + 1] : blocks.find(block => block.start.split(":").map(Number).reduce((h, m) => h * 60 + m) > minutes);
  const remaining = current ? Math.max(0, current.end.split(":").map(Number).reduce((h, m) => h * 60 + m) - minutes) : 0;
  return { current, upcoming, remaining };
}

export default function DashboardPage({ day, onNavigate }: { day: string; onNavigate: (tab: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [response, clockResponse] = await Promise.all([fetch(`/api/dashboard?date=${day}`, { cache: "no-store" }), fetch("/api/clock", { cache: "no-store" })]);
        if (!response.ok) throw new Error("Dashboard load nahi ho saka.");
        const result = await response.json() as Data;
        if (active) {
          setData(result); setError("");
          if (clockResponse.ok) { const clock = await clockResponse.json() as { serverNow: string }; setNow(new Date(clock.serverNow)); }
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Kuch ghalat ho gaya."); }
    };
    void load();
    const refresh = window.setInterval(() => { void load(); }, 30_000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [day]);
  const current = useMemo(() => currentScheduleInfo(day, now), [day, now]);
  const nav = ["Dashboard", "Aaj", "Review", "Graphs", "15 Din"];
  const date = `${weekdayName(day)}, ${formatDay(day)} 2026`;

  return <main className="dashboard-page">
    <header className="dash-top"><div className="dash-brand">✦ <b>command<span>center</span></b></div><nav>{nav.map((tab, i) => <button key={tab} className={tab === "Dashboard" ? "selected" : ""} onClick={() => onNavigate(tab)}><span>{["◫", "◷", "☾", "⌁", "▦"][i]}</span>{tab}</button>)}</nav><div className="dash-user"><span className="avatar">M</span><span><b>Mustafa</b><small>KARACHI · PKT</small></span></div></header>
    <div className="dash-content"><div className="dash-heading"><div><p className="eyebrow">YOUR COMMAND CENTER <span className="live-pill"><i /> YOUR PLAN IS LIVE</span></p><h1>Welcome back, Mustafa.</h1><p>Ek din. Ek qadam. Aaj tumhari kahani ka naya safha hai.</p></div><div className="dash-date">◷ <span>{date}<small>15 din ka reset · {formatDay(day)} — 21 Oct</small></span></div></div>
      {error && <div className="dash-error">{error} <button onClick={() => location.reload()}>Retry</button></div>}
      {!data ? <div className="score-grid">{scoreNames && Object.keys(scoreNames).map(key => <div className="score-card skeleton" key={key} />)}</div> : <>
        <div className="score-grid">{Object.entries(scoreNames).map(([key, name]) => { const value = data.scores?.[key] ?? 0; const trend = data.trends[key]; return <article className={`score-card ${key === "overall" ? "overall-score" : ""}`} key={key} style={{ "--score-color": scoreColors[key] } as React.CSSProperties}><div className="score-card-head"><span>{name.toUpperCase()}</span><i className={`trend-arrow ${trend.direction}`}>{trend.direction === "up" ? "↗" : trend.direction === "down" ? "↘" : "→"}</i></div><div className="score-value">{value}<small>/100</small></div><div className="score-track"><i style={{ width: `${value}%` }} /></div><p><b>{trend.verdict}</b><span>{trend.direction === "flat" ? "· stable" : `· ${trend.delta > 0 ? "+" : ""}${trend.delta} pts`}</span></p></article>; })}</div>
        <div className="dashboard-columns"><section className="dash-main-column"><article className="daily-progress-card"><div className="daily-progress-copy"><p className="eyebrow">{date.toUpperCase()}</p><h2>Aaj ki consistency</h2><p>Chhoti progress bhi progress hai.</p></div><div className="dash-ring" style={{ "--dash-progress": `${data.completion * 3.6}deg` } as React.CSSProperties}><div><b>{data.completion}<small>%</small></b><span>COMPLETE</span></div></div><div className="streak-stat"><span>✦</span><b>{data.streak}</b><small>din ki streak</small><em>{data.streak >= 3 ? "Kya baat hai!" : "Aaj se shuru karo"}</em></div></article>
          {data.previousPending && <button className="pending-prompt" onClick={() => onNavigate("Aaj")}><span>↗</span><div><b>Ye tick karna baaki hai</b><small>{data.previousPending.name} · Aaj ke schedule mein jao</small></div><i>→</i></button>}
          <article className="goals-card"><div className="goal-heading"><div><p className="eyebrow">THE BIGGER PICTURE</p><h2>15 din ke goals</h2></div><button onClick={() => onNavigate("15 Din")}>DETAILS <span>→</span></button></div><div className="goals-list">{[
            { name: "Outbound leads", current: data.goals.outbound.current, target: data.goals.outbound.target, unit: "leads", color: "#5683dc" },
            { name: "Medspa leads", current: data.goals.medspa.current, target: data.goals.medspa.target, unit: "leads", color: "#df9854" },
            { name: "Medspa clients", current: data.goals.clients.current, target: data.goals.clients.target, unit: "client", color: "#4e9b76" },
            { name: "LinkedIn inbound", current: data.goals.linkedinInbound.current, target: null, unit: "total", color: "#8170d8" },
            { name: "Startup MVP", current: data.goals.startup.current, target: 100, unit: "%", color: "#d77a9b" },
          ].map(goal => <div className="goal-row" key={goal.name}><div className="goal-label"><b>{goal.name}</b><span>{goal.target === null ? `${goal.current} ${goal.unit}` : `${goal.current} / ${goal.target} ${goal.unit}`}</span></div>{goal.target !== null && <div className="goal-track"><i style={{ width: `${Math.min(goal.current / goal.target * 100, 100)}%`, background: goal.color }} /></div>}</div>)}</div></article>
        </section><aside className="dash-side-column"><article className="abhi-card"><div className="abhi-top"><span><i /> ABHI</span><b>LIVE</b></div><h2>{current.current?.name ?? "Apna waqt apne liye"}</h2><p>{current.current ? `${current.current.start} — ${current.current.end} · ${Math.floor(current.remaining / 60) ? `${Math.floor(current.remaining / 60)}h ` : ""}${current.remaining % 60}m baqi` : "Routine ke darmiyan ka waqt"}</p><div className="abhi-line" /><small>NEXT UP</small><b className="next-block">{current.upcoming?.name ?? "Din mukammal"}</b><button onClick={() => onNavigate("Aaj")}>Aaj ka schedule <span>→</span></button></article>
          <article className={`review-status-card ${data.reviewComplete ? "complete" : ""}`}><span className="review-status-icon">{data.reviewComplete ? "✓" : "☾"}</span><div><b>{data.reviewComplete ? "Raat ka Review complete" : "Raat ka Review"}</b><p>{data.reviewComplete ? "Aaj ka reflection saved hai." : "Roz raat 12:30 se 1:00 tak unlock."}</p><button onClick={() => onNavigate("Review")}>{data.reviewComplete ? "Dekho" : "Review ka haal"} <span>→</span></button></div></article>
          <article className="quote-card"><span>“</span><p>Consistency, motivation se zyada powerful hai.</p><small>Aaj apna waada nibhao.</small></article>
        </aside></div>
      </>}
      <footer className="page-footer"><span>MADE FOR YOUR NEXT CHAPTER</span><span>DAY {String(Math.max(0, new Date(`${day}T00:00:00Z`).getUTCDate() - 6)).padStart(2, "0")} OF YOUR RESET <i>✦</i></span></footer>
    </div>
  </main>;
}
