"use client";

import { useState } from "react";

type Summary = {
  from: string; to: string; trackedBlocks: number; completion: number | null; submittedReviews: number;
  averageScores: Record<string, number | null>; goalCheckins: number; goalHours: number;
  habitCheckins: number; habitConsistency: number | null;
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const shifted = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export default function ComparePanel() {
  const now = today();
  const [ranges, setRanges] = useState([{ from: shifted(now, -6), to: now }, { from: shifted(now, -13), to: shifted(now, -7) }]);
  const [periods, setPeriods] = useState<Summary[] | null>(null);
  const [error, setError] = useState("");

  async function compare() {
    const [first, second] = ranges;
    const params = new URLSearchParams({ fromA: first.from, toA: first.to, fromB: second.from, toB: second.to });
    try {
      const response = await fetch(`/api/analytics/compare?${params}`, { cache: "no-store" });
      const payload = await response.json() as { periods?: Summary[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Comparison could not be loaded.");
      setPeriods(payload.periods ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Comparison could not be loaded.");
    }
  }

  return <section className="compare-panel">
    <div><p className="eyebrow">CUSTOM PERIOD ANALYTICS</p><h2>Compare any two periods</h2><p>Compare tracked schedule execution, saved reviews, goal effort, habits, and recorded scores.</p></div>
    <div className="compare-ranges">{ranges.map((range, index) => <fieldset key={index}><legend>Period {index + 1}</legend><label>From<input type="date" value={range.from} onChange={event => setRanges(current => current.map((item, i) => i === index ? { ...item, from: event.target.value } : item))}/></label><label>To<input type="date" value={range.to} onChange={event => setRanges(current => current.map((item, i) => i === index ? { ...item, to: event.target.value } : item))}/></label></fieldset>)}<button className="life-primary" onClick={() => void compare()}>Compare periods</button></div>
    {error && <p className="life-error" role="alert">{error}</p>}
    {periods && <div className="compare-results">{periods.map((period,index)=><article key={index}><p className="eyebrow">{period.from} — {period.to}</p><div><span>Tracked schedule completion</span><b>{period.completion===null?"—":`${period.completion}%`}</b></div><div><span>Goal check-ins · hours</span><b>{period.goalCheckins} · {period.goalHours}h</b></div><div><span>Not To Do consistency</span><b>{period.habitConsistency===null?"—":`${period.habitConsistency}% (${period.habitCheckins} check-ins)`}</b></div><div><span>Night reviews · tracked blocks</span><b>{period.submittedReviews} · {period.trackedBlocks}</b></div><div className="compare-scores">{Object.entries(period.averageScores).map(([name,value])=><span key={name}>{name} <b>{value===null?"—":value}</b></span>)}</div></article>)}</div>}
  </section>;
}
