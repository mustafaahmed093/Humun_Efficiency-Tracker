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
  activities?: { id: string; name: string; start: string | null; end: string | null; category: string; status: string }[];
};
type LifeData = {
  date: string; activeGoals: number; totalGoals: number; primaryGoal: { id: string; title: string; target_date: string | null; target_value: number | null; current_value: number; target_unit: string | null } | null;
  goalCheckins: number; activeHabits: number; totalHabits: number; habitCheckins: number;
  planned: { total: number; completed: number; partial: number; missed: number };
  pendingGoals: number; pendingHabits: number; atRiskGoals: number; overdueGoals: number; upcomingDeadlines: { id: string; title: string; date: string | null }[];
};
type DashboardCard = "scores" | "primaryGoal" | "liveSchedule" | "review" | "lifeSummary";
const dashboardCards: { id: DashboardCard; label: string }[] = [{id:"scores",label:"Performance scores"},{id:"primaryGoal",label:"Primary goal"},{id:"liveSchedule",label:"Current schedule"},{id:"review",label:"Nightly review"},{id:"lifeSummary",label:"Life system summary"}];

const scoreNames: Record<string, string> = { business: "Business", health: "Health", mental: "Mental", focus: "Focus", religious: "Religious", overall: "Overall" };
const scoreColors: Record<string, string> = { business: "#5683dc", health: "#df9854", mental: "#d77a9b", focus: "#8170d8", religious: "#4e9b76", overall: "#376e50" };

function currentScheduleInfo(day: string, now: Date, datedActivities?: Data["activities"]) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  let minutes = local.getHours() * 60 + local.getMinutes();
  if (local.getHours() < 4) minutes += 1440;
  const blocks = datedActivities
    ? datedActivities.map(item => ({ id: item.id, name: item.name, start: item.start ?? "00:00", end: item.end ?? "00:00", category: item.category }))
    : getSchedule(day).filter(block => block.category !== "Review");
  const current = blocks.find(block => {
    const [sh, sm] = block.start.split(":").map(Number); const [eh, em] = block.end.split(":").map(Number);
    const start = sh * 60 + sm;
    const rawEnd = eh * 60 + em;
    return minutes >= start && minutes < (rawEnd <= start ? rawEnd + 1440 : rawEnd);
  });
  const upcoming = current ? blocks[blocks.indexOf(current) + 1] : blocks.find(block => block.start.split(":").map(Number).reduce((h, m) => h * 60 + m) > minutes);
  const remaining = current ? Math.max(0, (() => { const [h, m] = current.end.split(":").map(Number); const end = h * 60 + m; return end <= current.start.split(":").map(Number).reduce((a, b) => a * 60 + b, 0) ? end + 1440 : end; })() - minutes) : 0;
  return { current, upcoming, remaining };
}

export default function DashboardPage({ day, onNavigate }: { day: string; onNavigate: (tab: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState("");
  const [lifeData, setLifeData] = useState<LifeData | null>(null);
  const [hiddenCards, setHiddenCards] = useState<DashboardCard[]>([]);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  useEffect(() => { const timer=window.setTimeout(()=>{try { const saved=localStorage.getItem("cc-dashboard-hidden-v1"); if(saved) setHiddenCards(JSON.parse(saved) as DashboardCard[]); } catch { setHiddenCards([]); }},0);return()=>window.clearTimeout(timer); }, []);
  function toggleCard(card:DashboardCard) { const next=hiddenCards.includes(card)?hiddenCards.filter(item=>item!==card):[...hiddenCards,card];setHiddenCards(next);localStorage.setItem("cc-dashboard-hidden-v1",JSON.stringify(next)); }
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
    const loadLifeData = async () => {
      try {
        const response = await fetch("/api/life-dashboard", { cache: "no-store" });
        if (!response.ok) throw new Error("Life system summary is unavailable.");
        if (active) setLifeData(await response.json() as LifeData);
      } catch {
        if (active) setLifeData(null);
      }
    };
    void load();
    void loadLifeData();
    const refresh = window.setInterval(() => { void load(); }, 30_000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [day]);
  const current = useMemo(() => currentScheduleInfo(day, now, data?.activities), [day, now, data?.activities]);
  const nav = ["Dashboard", "Aaj", "Review", "Goals", "Not To Do", "Plan a Day", "Past Status", "Graphs"];
  const date = `${weekdayName(day)}, ${formatDay(day)} ${day.slice(0, 4)}`;

  return <main className="dashboard-page">
    <header className="dash-top"><div className="dash-brand">✦ <b>command<span>center</span></b></div><nav>{nav.map((tab, i) => <button key={tab} className={tab === "Dashboard" ? "selected" : ""} onClick={() => onNavigate(tab)}><span>{["◫", "◷", "☾", "◎", "↘", "▤", "▦", "⌁"][i]}</span>{tab}</button>)}</nav><div className="dash-user"><span className="avatar">M</span><span><b>Mustafa</b><small>KARACHI · PKT</small></span></div></header>
    <div className="dash-content"><div className="dash-heading"><div><p className="eyebrow">YOUR COMMAND CENTER <span className="live-pill"><i /> LIVE</span></p><h1 className="dashboard-motto">Stop being distracted. Start doing the fucking work. You have a lot to achieve.</h1><p className="dashboard-tagline">NO EXCUSES. NO DISTRACTIONS. JUST EXECUTION.</p></div><div className="dash-date">◷ <span>{date}<small>Asia/Karachi · Continuous tracking</small></span></div></div>
      <div className="dash-preferences"><button className="dash-customize-button" onClick={()=>setCustomizeOpen(value=>!value)} aria-expanded={customizeOpen}>Customize dashboard</button>{customizeOpen&&<div className="dash-customize-panel"><b>Show dashboard sections</b>{dashboardCards.map(card=><label key={card.id}><input type="checkbox" checked={!hiddenCards.includes(card.id)} onChange={()=>toggleCard(card.id)}/>{card.label}</label>)}</div>}</div>
      {error && <div className="dash-error">{error} <button onClick={() => location.reload()}>Retry</button></div>}
      {!data ? <div className="score-grid">{scoreNames && Object.keys(scoreNames).map(key => <div className="score-card skeleton" key={key} />)}</div> : <>
        <div className="score-grid" style={{display:hiddenCards.includes("scores")?"none":undefined}}>{Object.entries(scoreNames).map(([key, name]) => { const value = data.scores?.[key] ?? null; const trend = data.trends[key]; return <article className={`score-card ${key === "overall" ? "overall-score" : ""}`} key={key} style={{ "--score-color": scoreColors[key] } as React.CSSProperties}><div className="score-card-head"><span>{name.toUpperCase()}</span><i className={`trend-arrow ${trend.direction}`}>{trend.direction === "up" ? "↗" : trend.direction === "down" ? "↘" : "→"}</i></div><div className="score-value">{value ?? "—"}<small>{value === null ? "no record" : "/100"}</small></div><div className="score-track"><i style={{ width: `${value ?? 0}%` }} /></div><p><b>{value === null ? "No score recorded" : trend.verdict}</b><span>{value === null ? "· missing stays missing" : trend.direction === "flat" ? "· stable" : `· ${trend.delta > 0 ? "+" : ""}${trend.delta} pts`}</span></p></article>; })}</div>
        <div className="dashboard-columns"><section className="dash-main-column"><article className="daily-progress-card"><div className="daily-progress-copy"><p className="eyebrow">{date.toUpperCase()}</p><h2>Aaj ki consistency</h2><p>Chhoti progress bhi progress hai.</p></div><div className="dash-ring" style={{ "--dash-progress": `${data.completion * 3.6}deg` } as React.CSSProperties}><div><b>{data.completion}<small>%</small></b><span>COMPLETE</span></div></div><div className="streak-stat"><span>✦</span><b>{data.streak}</b><small>din ki streak</small><em>{data.streak >= 3 ? "Kya baat hai!" : "Aaj se shuru karo"}</em></div></article>
          {data.previousPending && <button className="pending-prompt" onClick={() => onNavigate("Aaj")}><span>↗</span><div><b>Ye tick karna baaki hai</b><small>{data.previousPending.name} · Aaj ke schedule mein jao</small></div><i>→</i></button>}
          <article className="goals-card" style={{display:hiddenCards.includes("primaryGoal")?"none":undefined}}><div className="goal-heading"><div><p className="eyebrow">THE BIGGER PICTURE</p><h2>Primary focus</h2></div><button onClick={() => onNavigate("Goals")}>ALL GOALS <span>→</span></button></div><div className="goals-list">{[
            ...(lifeData?.primaryGoal ? [{ name: lifeData.primaryGoal.title, current: lifeData.primaryGoal.current_value, target: lifeData.primaryGoal.target_value, unit: lifeData.primaryGoal.target_unit ?? "", color: "#4e9b76" }] : []),
          ].map(goal => <div className="goal-row" key={goal.name}><div className="goal-label"><b>{goal.name}</b><span>{goal.target === null ? `${goal.current} ${goal.unit}` : `${goal.current} / ${goal.target} ${goal.unit}`}</span></div>{goal.target !== null && goal.target > 0 && <div className="goal-track"><i style={{ width: `${Math.min(goal.current / goal.target * 100, 100)}%`, background: goal.color }} /></div>}</div>)}{!lifeData?.primaryGoal && <p className="subheading">Add a goal to see your primary focus here.</p>}</div></article>
        </section><aside className="dash-side-column"><article className="abhi-card" style={{display:hiddenCards.includes("liveSchedule")?"none":undefined}}><div className="abhi-top"><span><i /> ABHI</span><b>LIVE</b></div><h2>{current.current?.name ?? "Apna waqt apne liye"}</h2><p>{current.current ? `${current.current.start} — ${current.current.end} · ${Math.floor(current.remaining / 60) ? `${Math.floor(current.remaining / 60)}h ` : ""}${current.remaining % 60}m baqi` : "Routine ke darmiyan ka waqt"}</p><div className="abhi-line" /><small>NEXT UP</small><b className="next-block">{current.upcoming?.name ?? "Din mukammal"}</b><button onClick={() => onNavigate("Aaj")}>Aaj ka schedule <span>→</span></button></article>
          <article className={`review-status-card ${data.reviewComplete ? "complete" : ""}`} style={{display:hiddenCards.includes("review")?"none":undefined}}><span className="review-status-icon">{data.reviewComplete ? "✓" : "☾"}</span><div><b>{data.reviewComplete ? "Raat ka Review complete" : "Raat ka Review"}</b><p>{data.reviewComplete ? "Aaj ka reflection saved hai." : "Roz raat 12:30 se 1:00 tak unlock."}</p><button onClick={() => onNavigate("Review")}>{data.reviewComplete ? "Dekho" : "Review ka haal"} <span>→</span></button></div></article>
          <article className="quote-card"><span>“</span><p>Consistency, motivation se zyada powerful hai.</p><small>Aaj apna waada nibhao.</small></article>
        </aside></div>
      </>}
      {lifeData && <section className="life-unified-dashboard" style={{display:hiddenCards.includes("lifeSummary")?"none":undefined}}><p className="eyebrow">YOUR WHOLE DAY · {lifeData.date}</p><h2>Life system check-in</h2><div className="life-unified-cards">
        <article><b>{lifeData.primaryGoal?.title ?? "Choose a primary goal"}</b><small>{lifeData.activeGoals} active goals · {lifeData.goalCheckins} goal check-ins today</small></article>
        <article><b>{lifeData.planned.completed}/{lifeData.planned.total} planned activities complete</b><small>{lifeData.planned.partial} partial · {lifeData.planned.missed} missed</small></article>
        <article><b>{lifeData.habitCheckins}/{lifeData.activeHabits} Not To Do check-ins</b><small>{lifeData.totalGoals} saved goals · {lifeData.totalHabits} tracking rules</small></article>
      </div><div className="life-unified-actions"><button onClick={() => onNavigate("Goals")}>Check in on goals</button><button onClick={() => onNavigate("Plan a Day")}>Update today&apos;s plan</button><button onClick={() => onNavigate("Not To Do")}>Private habit check-in</button><button onClick={() => onNavigate("Past Status")}>Browse history</button></div></section>}
      {lifeData&&<section className="dashboard-alerts"><div><p className="eyebrow">ATTENTION</p><h2>Needs a look</h2></div><div className="dashboard-alert-list">{lifeData.pendingGoals>0&&<button onClick={()=>onNavigate("Goals")}>{lifeData.pendingGoals} goal check-in{lifeData.pendingGoals===1?"":"s"} pending <span>Update goals →</span></button>}{data&&!data.reviewComplete&&<button onClick={()=>onNavigate("Review")}>Nightly review is not complete <span>Open review →</span></button>}{lifeData.atRiskGoals>0&&<button onClick={()=>onNavigate("Goals")}>{lifeData.atRiskGoals} goal{lifeData.atRiskGoals===1?"":"s"} at risk or overdue <span>Review goals →</span></button>}{lifeData.pendingHabits>0&&<button onClick={()=>onNavigate("Not To Do")}>{lifeData.pendingHabits} private check-in{lifeData.pendingHabits===1?"":"s"} pending <span>Open check-in →</span></button>}{lifeData.upcomingDeadlines.map(goal=><button key={goal.id} onClick={()=>onNavigate("Goals")}>Upcoming goal deadline · {goal.title} · {goal.date}<span>View goal →</span></button>)}{lifeData.planned.missed>0&&<button onClick={()=>onNavigate("Plan a Day")}>{lifeData.planned.missed} activities marked missed <span>Review schedule →</span></button>}{lifeData.atRiskGoals===0&&lifeData.pendingGoals===0&&lifeData.pendingHabits===0&&data?.reviewComplete&&!lifeData.upcomingDeadlines.length&&lifeData.planned.missed===0&&<p>No outstanding alerts from current records.</p>}</div></section>}\n      <footer className="page-footer"><span>MADE FOR YOUR NEXT CHAPTER</span><span>DAY {String(Math.max(0, new Date(`${day}T00:00:00Z`).getUTCDate() - 6)).padStart(2, "0")} OF YOUR RESET <i>✦</i></span></footer>
    </div>
  </main>;
}
