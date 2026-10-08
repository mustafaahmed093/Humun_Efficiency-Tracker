"use client";

import { useEffect, useState } from "react";
import { formatDay } from "@/lib/schedule";

type ExportData = {
  days: string[];
  completion: { plan_day: string; completion_pct: number; logged: number }[];
  dailyScores: { plan_day: string; business?: number; health?: number; mental?: number; focus?: number; religious?: number; overall?: number }[];
  goals: { plan_day: string; outbound_leads: number; outbound_target: number; medspa_leads: number; medspa_target: number }[];
  reviews: { plan_day: string; answers: Record<string, unknown> }[];
  prayers: { plan_day: string; prayer: string; status: string }[];
  crossedReasons: { plan_day: string; block: string; reason: string }[];
};
const scoreKeys = ["business", "health", "mental", "focus", "religious", "overall"] as const;
const scoreLabels: Record<string, string> = { business: "Business", health: "Health", mental: "Mental", focus: "Focus", religious: "Religious", overall: "Overall" };
const colors: Record<string, string> = { business: "#5683dc", health: "#df9854", mental: "#d77a9b", focus: "#8170d8", religious: "#4e9b76", overall: "#376e50", inbound: "#8170d8", medspa: "#df9854", focusLine: "#8170d8", overthink: "#d77a9b" };
const empty = (data: number[]) => !data.some(value => value > 0);

function ChartCard({ eyebrow, title, children, note, className = "" }: { eyebrow: string; title: string; children: React.ReactNode; note?: string; className?: string }) {
  return <section className={`chart-card ${className}`}><div className="chart-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{note && <small>{note}</small>}</div>{children}</section>;
}
function EmptyChart({ children = "Data yahan aayega jab tum apna check-in karoge." }: { children?: string }) { return <div className="chart-empty"><span>⌁</span><p>{children}</p></div>; }
function BarChart({ labels, values, color, suffix = "%", target, hasData }: { labels: string[]; values: number[]; color: string; suffix?: string; target?: number; hasData?: boolean }) {
  if (!(hasData ?? !empty(values))) return <EmptyChart />;
  const max = Math.max(target ?? 0, ...values, 1) * 1.12;
  const width = 600; const height = 190; const top = 12; const bottom = 28; const plotH = height - top - bottom; const slot = width / Math.max(values.length, 1); const barWidth = Math.max(5, Math.min(22, slot * .58));
  return <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${values.length} day bar chart`}>
    {[0, .5, 1].map(f => <g key={f}><line x1="0" x2={width} y1={top + plotH * f} y2={top + plotH * f} stroke="#edf0ee" /><text x="2" y={top + plotH * f - 3} fill="#a3aca6" fontSize="8">{Math.round(max * (1 - f))}{suffix}</text></g>)}
    {target !== undefined && <line x1="0" x2={width} y1={top + plotH * (1 - target / max)} y2={top + plotH * (1 - target / max)} stroke="#ba9c59" strokeDasharray="5 4" />}
    {values.map((value, i) => { const barHeight = value / max * plotH; return <g key={labels[i]}><title>{labels[i]} · {value}{suffix}</title><rect x={i * slot + (slot - barWidth) / 2} y={top + plotH - barHeight} width={barWidth} height={Math.max(1, barHeight)} rx="3" fill={color} opacity={.86} /><text x={i * slot + slot / 2} y={height - 7} textAnchor="middle" fill="#9aa39d" fontSize="7">{labels[i]}</text></g>; })}
  </svg>;
}
function LineChart({ labels, series, max = 100, suffix = "", hasData }: { labels: string[]; series: { name: string; color: string; values: (number | null)[]; dash?: "target" | "pace" }[]; max?: number; suffix?: string; hasData?: boolean }) {
  if (!(hasData ?? series.some(item => item.values.some(value => value !== null)))) return <EmptyChart />;
  const width = 600; const height = 190; const left = 24; const right = 10; const top = 12; const bottom = 29; const plotW = width - left - right; const plotH = height - top - bottom;
  return <div><svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart">
    {[0,.25,.5,.75,1].map(f => <g key={f}><line x1={left} x2={width-right} y1={top+plotH*f} y2={top+plotH*f} stroke="#edf0ee"/><text x="1" y={top+plotH*f-2} fill="#a3aca6" fontSize="8">{Math.round(max*(1-f))}{suffix}</text></g>)}
    {series.map(line => { const coordinates = line.values.map((value, index) => value === null ? null : { x: left + (labels.length <= 1 ? plotW/2 : index*plotW/(labels.length-1)), y: top + plotH*(1-Math.max(0,Math.min(value,max))/max), value }).filter((value): value is { x: number; y: number; value: number } => value !== null); const path = coordinates.map(({x,y}, index) => `${index ? "L" : "M"}${x},${y}`).join(" "); return <g key={line.name}><path d={path} fill="none" stroke={line.color} strokeWidth="2" strokeDasharray={line.dash === "target" ? "5 4" : line.dash === "pace" ? "2 4" : undefined} strokeLinecap="round" strokeLinejoin="round"/>{coordinates.map(({x,y,value}, index) => <circle key={`${line.name}-${index}`} cx={x} cy={y} r="3" fill="white" stroke={line.color} strokeWidth="2"><title>{line.name}: {Math.round(value)}{suffix}</title></circle>)}</g>; })}
    {labels.map((label,index)=><text key={label} x={left+(labels.length<=1?plotW/2:index*plotW/(labels.length-1))} y={height-7} textAnchor="middle" fill="#9aa39d" fontSize="7">{label}</text>)}
  </svg><div className="chart-legend">{series.map(line=><span key={line.name}><i style={{background:line.color}}/>{line.name}</span>)}</div></div>;
}

function FocusChart({ labels, focus, overthinking }: { labels: string[]; focus: (number|null)[]; overthinking: (number|null)[] }) {
  if (!focus.some(value=>value!==null) && !overthinking.some(value=>value!==null)) return <EmptyChart />;
  const width=600,height=190,left=24,right=10,top=12,bottom=29,plotW=width-left-right,plotH=height-top-bottom,slot=plotW/Math.max(labels.length,1),barWidth=Math.max(5,Math.min(17,slot*.42));
  const coords=focus.map((value,index)=>value===null?null:{x:left+(labels.length<=1?plotW/2:index*plotW/(labels.length-1)),y:top+plotH*(1-value/100),value}).filter((value):value is {x:number;y:number;value:number}=>value!==null);
  const path=coords.map(({x,y},index)=>`${index?"L":"M"}${x},${y}`).join(" ");
  return <div><svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Focus line and overthinking bars">
    {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={left} x2={width-right} y1={top+plotH*f} y2={top+plotH*f} stroke="#edf0ee"/><text x="1" y={top+plotH*f-2} fill="#a3aca6" fontSize="8">{Math.round(100*(1-f))}</text></g>)}
    {overthinking.map((value,index)=>value===null?null:<g key={`bar-${index}`}><title>{labels[index]} · overthinking {value/10} times</title><rect x={left+index*slot+(slot-barWidth)/2} y={top+plotH*(1-value/100)} width={barWidth} height={plotH*value/100} rx="3" fill={colors.overthink} opacity=".65"/></g>)}
    <path d={path} fill="none" stroke={colors.focusLine} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{coords.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r="3" fill="white" stroke={colors.focusLine} strokeWidth="2"><title>Focus {point.value}%</title></circle>)}
    {labels.map((label,index)=><text key={label} x={left+(labels.length<=1?plotW/2:index*plotW/(labels.length-1))} y={height-7} textAnchor="middle" fill="#9aa39d" fontSize="7">{label}</text>)}
  </svg><div className="chart-legend"><span><i style={{background:colors.focusLine}}/>Focus</span><span><i style={{background:colors.overthink}}/>Overthinking count (×10 scale)</span></div></div>;
}

export default function GraphsPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [data, setData] = useState<ExportData | null>(null);
  const [selected, setSelected] = useState<string[]>(["business", "health", "mental", "focus", "religious", "overall"]);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void fetch("/api/export?includeSensitive=1", { cache: "no-store" }).then(async response => { if (!response.ok) throw new Error("Graphs load nahi ho sake."); return await response.json() as ExportData; }).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Try again."); }); return () => { active = false; }; }, []);
  const nav = ["Dashboard", "Aaj", "Review", "Graphs", "15 Din"];
  if (!data) return <GraphFrame nav={nav} onNavigate={onNavigate}><div className="graphs-loading">{error || "Graphs tayyar ho rahe hain…"}</div></GraphFrame>;
  const labels = data.days.map(day => formatDay(day).split(" ")[0]);
  const completion = data.completion.map(item => item.completion_pct);
  const hasCheckins = data.completion.some(item => item.logged > 0);
  const scoreMap = new Map(data.dailyScores.map(row => [row.plan_day, row]));
  const reviewMap = new Map(data.reviews.filter(row => row.answers).map(row => [row.plan_day, row.answers]));
  const scoreSeries = selected.map(key => { const scoreKey = key as typeof scoreKeys[number]; return { name: scoreLabels[scoreKey], color: colors[scoreKey], values: data.days.map(day => scoreMap.get(day)?.[scoreKey] ?? null) }; });
  const reviews = data.days.map(day => reviewMap.get(day));
  const cumulativeOutbound = data.goals.map(item => item.outbound_leads);
  const cumulativeMedspa = data.goals.map(item => item.medspa_leads);
  const targetPaceOutbound = data.days.map((_, index) => 300 * (index + 1) / 15);
  const targetPaceMedspa = data.days.map((_, index) => 560 * (index + 1) / 15);
  const funnel = [
    { name: "Leads", value: reviews.reduce((sum, review) => sum + Number(review?.medspaLeads || 0), 0), color: "#5683dc" },
    { name: "Replies", value: reviews.reduce((sum, review) => sum + Number(review?.medspaReplies || 0), 0), color: "#8170d8" },
    { name: "Calls", value: reviews.reduce((sum, review) => sum + Number(review?.medspaCalls || 0), 0), color: "#df9854" },
    { name: "Won", value: reviews.reduce((sum, review) => sum + Number(review?.medspaConverted || 0), 0), color: "#4e9b76" },
  ];
  const focusValues = reviews.map(review => typeof review?.focusRating === "number" ? review.focusRating * 10 : null);
  const overthinkingValues = reviews.map(review => typeof review?.overthinkingCount === "number" ? review.overthinkingCount * 10 : null);
  const moodScore = (value: unknown) => value === "Productive" ? 100 : value === "Guzara" ? 60 : value === "Sad" ? 20 : null;
  const stressScore = (value: unknown) => value === "Nahi" ? 100 : value === "Thoda" ? 60 : value === "Zyada" ? 20 : null;
  const sleeps = reviews.map(review => typeof review?.sleepHours === "number" ? review.sleepHours : null);
  const prayerNames = ["Fajr", "Zohr", "Asr", "Maghrib", "Isha"];
  const reasonCounts = new Map<string, number>();
  data.crossedReasons.forEach(row => reasonCounts.set(row.reason || "Wajah nahi likhi", (reasonCounts.get(row.reason || "Wajah nahi likhi") ?? 0) + 1));
  const maxReason = Math.max(...reasonCounts.values(), 0);
  return <GraphFrame nav={nav} onNavigate={onNavigate}><div className="graphs-content"><div className="graphs-title"><div><p className="eyebrow">15 DIN KA SAFAR · VISUAL REPORT</p><h1>Apni growth dekho.</h1><p>Har data point, tumhari mehnat ki kahani.</p></div><button onClick={() => onNavigate("15 Din")}>15 Din dekho →</button></div>
    <div className="chart-grid"><ChartCard eyebrow="CONSISTENCY" title="Daily schedule completion" note="Completion %"><BarChart labels={labels} values={completion} color="#57956b" hasData={hasCheckins} /></ChartCard>
      <ChartCard eyebrow="SCORE TRENDS" title="Six scores over time"><div className="chart-toggles">{scoreKeys.map(key => <button key={key} className={selected.includes(key) ? "active" : ""} style={{ "--toggle-color": colors[key] } as React.CSSProperties} onClick={() => setSelected(current => current.includes(key) ? current.filter(v => v !== key) : [...current, key])}><i />{scoreLabels[key]}</button>)}</div><LineChart labels={labels} series={scoreSeries} suffix="" /></ChartCard>
      <ChartCard eyebrow="GOAL PACE" title="Cumulative leads vs targets" note="Dashed = target · dotted = pace"><LineChart labels={labels} hasData={data.reviews.some(row => row.answers.outboundLeads !== undefined || row.answers.medspaLeads !== undefined)} series={[{ name: "Outbound actual", color: colors.business, values: cumulativeOutbound }, { name: "Outbound target 300", color: colors.business, values: data.days.map(()=>300), dash: "target" }, { name: "Outbound pace", color: colors.business, values: targetPaceOutbound, dash: "pace" }, { name: "Medspa actual", color: colors.medspa, values: cumulativeMedspa }, { name: "Medspa target 560", color: colors.medspa, values: data.days.map(()=>560), dash: "target" }, { name: "Medspa pace", color: colors.medspa, values: targetPaceMedspa, dash: "pace" }]} max={600} /></ChartCard>
      <ChartCard eyebrow="MEDSPA AGENCY" title="Lead funnel" note="15-day totals">{funnel.every(item => item.value === 0) ? <EmptyChart /> : <div className="funnel-bars">{funnel.map(item => <div key={item.name}><b>{item.value}</b><i><span style={{ height: `${Math.max(3, item.value / Math.max(...funnel.map(v => v.value), 1) * 100)}%`, background: item.color }} /></i><small>{item.name}</small></div>)}</div>}</ChartCard>
      <ChartCard eyebrow="MENTAL + FOCUS" title="Focus aur overthinking" note="Bars use ×10 scale"><FocusChart labels={labels} focus={focusValues} overthinking={overthinkingValues} /></ChartCard>
      <ChartCard eyebrow="DAILY CHECK-IN" title="Mood aur stress"><LineChart labels={labels} series={[{ name: "Mood", color: colors.mental, values: reviews.map(review => moodScore(review?.mood)) }, { name: "Stress", color: colors.business, values: reviews.map(review => stressScore(review?.stress)) }]} /></ChartCard>
      <ChartCard eyebrow="REST" title="Sleep vs 8 hours" note="Hours per night"><LineChart labels={labels} max={10} suffix="h" hasData={sleeps.some(value => value !== null)} series={[{ name: "Sleep", color: colors.health, values: sleeps }, { name: "8-hour target", color: "#a6b6aa", values: data.days.map(() => 8), dash: "target" }]} /></ChartCard>
      <ChartCard eyebrow="RELIGIOUS PRACTICE" title="Prayer consistency · 15 days" className="heatmap-card">{!data.prayers.some(item => item.status === "done" || item.status === "missed") ? <EmptyChart /> : <div className="prayer-heatmap"><div className="heatmap-labels"><span />{prayerNames.map(name => <span key={name}>{name}</span>)}</div><div className="heatmap-days">{data.days.map(day => <div className="heatmap-day" key={day}><small>{formatDay(day).split(" ")[0]}</small>{prayerNames.map(name => { const status = data.prayers.find(item => item.plan_day === day && item.prayer === name)?.status; return <i className={status === "done" ? "done" : status === "missed" ? "missed" : ""} title={`${day} · ${name}: ${status ?? "unlogged"}`} key={name} />; })}</div>)}</div></div>}</ChartCard>
      <ChartCard eyebrow="PATTERN CHECK" title="Kya cheez rok rahi hai?" className="reasons-card">{!reasonCounts.size ? <EmptyChart /> : <div className="reason-bars">{[...reasonCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([reason,count])=><div key={reason}><span>{reason}</span><i><b style={{width:`${count/maxReason*100}%`}} /></i><strong>{count}</strong></div>)}</div>}</ChartCard>
    </div><footer className="page-footer"><span>MADE FOR YOUR NEXT CHAPTER</span><span>YOUR DATA STAYS PRIVATE <i>✦</i></span></footer></div></GraphFrame>;
}

function GraphFrame({ children, nav, onNavigate }: { children: React.ReactNode; nav: string[]; onNavigate: (tab: string) => void }) {
  return <main className="graphs-app"><header className="dash-top"><div className="dash-brand">✦ <b>command<span>center</span></b></div><nav>{nav.map((tab,index)=><button key={tab} className={tab === "Graphs" ? "selected" : ""} onClick={()=>onNavigate(tab)}><span>{["◫","◷","☾","⌁","▦"][index]}</span>{tab}</button>)}</nav><div className="dash-user"><span className="avatar">M</span><span><b>Mustafa</b><small>KARACHI · PKT</small></span></div></header>{children}</main>;
}
