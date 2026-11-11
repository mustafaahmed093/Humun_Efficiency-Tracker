"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LifeFrame from "@/app/life-frame";

type Day = { date: string; actualRecorded: boolean; scheduled: number; done: number; missed: number; partial: number; completion: number | null; score: number | null; reviewComplete: boolean; goalCheckins: number; habitCheckins: number };
type Detail = { date: string; activities: { id?: string; title?: string; name?: string; start_time?: string | null; end_time?: string | null; start?: string; end?: string; category: string; status: string; reason?: string | null }[]; scores: Record<string, number> | null; review: { answers: Record<string, unknown>; submitted_at: string | null } | null; goals: { title: string; hours: number; output_value: number | null }[]; habits: { title: string; outcome: string; urges: number }[] };
type Payload = { month: string; startDate: string; leading: number; days: Day[]; selected?: Detail };
const localMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const monthLabel = (month: string) => new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

export default function PastStatusPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [month, setMonth] = useState(localMonth());
  const [selectedDate, setSelectedDate] = useState("");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [category, setCategory] = useState("All categories");
  const [error, setError] = useState("");

  const load = useCallback(async (date = "") => {
    try {
      const suffix = date ? `&date=${date}` : "";
      const response = await fetch(`/api/past-status?month=${month}${suffix}`, { cache: "no-store" });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error ?? "Past Status could not be loaded."); }
      setPayload(await response.json() as Payload); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Past Status could not be loaded."); }
  }, [month]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(""); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!selectedDate) return;
    const timer = window.setTimeout(() => { void load(selectedDate); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, selectedDate]);

  const categories = useMemo(()=>["All categories",...new Set(payload?.selected?.activities.map(item=>item.category)??[])],[payload]);
  const shownActivities = payload?.selected?.activities.filter(activity=>category==="All categories"||activity.category===category)??[];
  function shiftMonth(amount:number) {
    const [year, value] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year,value-1+amount,1));
    setMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,"0")}`);
  }
  const weekdays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

  return <LifeFrame active="Past Status" onNavigate={onNavigate}>
    <section className="life-content">
      <header className="life-heading"><div><p className="eyebrow">REAL RECORDS · NO FABRICATED HISTORY</p><h1>Past Status</h1><p>Browse dated records from your actual tracking history.</p></div><div className="month-controls"><button onClick={()=>shiftMonth(-1)}>‹</button><b>{monthLabel(month)}</b><button onClick={()=>shiftMonth(1)}>›</button></div></header>
      {error&&<p className="life-error" role="alert">{error}</p>}
      <div className="past-status-layout"><section className="calendar-panel"><div className="calendar-weekdays">{weekdays.map(day=><span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({length:payload?.leading??0},(_,index)=><span className="calendar-blank" key={`blank-${index}`}/>)}{payload?.days.map(day=><button key={day.date} className={`calendar-day ${day.actualRecorded?"recorded":"no-record"} ${day.completion===null?"":day.completion>=80?"excellent":day.completion>=50?"good":"poor"} ${selectedDate===day.date?"selected":""}`} onClick={()=>setSelectedDate(day.date)} title={`${day.date} · ${day.actualRecorded?`${day.completion??0}% completion`:"No recorded activity"}`}><b>{Number(day.date.slice(-2))}</b>{day.actualRecorded&&<small>{day.completion===null?"·":`${day.completion}%`}</small>}{day.score!==null&&<i>{day.score}</i>}</button>)}</div><div className="calendar-legend"><span><i className="excellent"/>Excellent</span><span><i className="good"/>Good</span><span><i className="poor"/>Needs care</span><span><i className="no-record"/>No data</span></div><p className="calendar-start">Tracking history begins: {payload?.startDate??"Loading…"}. Earlier dates are not treated as records.</p></section>
        <aside className="history-detail"><h2>{selectedDate||"Choose a date"}</h2>{!selectedDate?<p>Select any calendar day to view its record. Days without entries remain explicitly marked as no data.</p>:!payload?.selected?<p>Loading day details…</p>:<><div className="history-score-grid">{["overall","business","health","mental","focus","religious"].map(key=><span key={key}>{key}<b>{payload.selected?.scores?.[key]??"—"}</b></span>)}</div><p>Schedule: {shownActivities.filter(item=>item.status==="done"||item.status==="completed").length} complete · {shownActivities.filter(item=>item.status==="missed").length} missed</p><label className="history-filter">Category<select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select></label><div className="history-timeline">{shownActivities.map((activity,index)=><article key={activity.id??index}><small>{activity.start_time??activity.start??"—"} – {activity.end_time??activity.end??"—"} · {activity.category}</small><b>{activity.title??activity.name}</b><span>{activity.status}{activity.reason?` · ${activity.reason}`:""}</span></article>)}</div>{payload.selected?.goals.length>0&&<><h3>Goal execution</h3>{payload.selected.goals.map((goal,index)=><p key={index}>{goal.title} · {goal.hours}h{goal.output_value!==null?` · output ${goal.output_value}`:""}</p>)}</>}{payload.selected?.habits.length>0&&<><h3>Private Not To Do entries</h3>{payload.selected.habits.map((habit,index)=><p key={index}>{habit.title} · {habit.outcome} · urges {habit.urges}</p>)}</>}{payload.selected?.review&&<details><summary>Nightly review {payload.selected.review.submitted_at?"submitted":"draft"}</summary><pre>{JSON.stringify(payload.selected.review.answers,null,2)}</pre></details>}</>}</aside></div>
    </section>
  </LifeFrame>;
}
