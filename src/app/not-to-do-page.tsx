"use client";

import { useCallback, useEffect, useState } from "react";
import LifeFrame from "@/app/life-frame";

type Rule = {
  id: string; title: string; category: string; active: boolean;
  data: { why?: string; triggers?: string[]; replacement?: string; emergencyPlan?: string[]; commitment?: string };
  metrics: { currentStreak: number; longestStreak: number; trackedDays: number; avoidedDays: number; totalUrgesResisted: number; slips: number; lastOccurrence: string | null; daysSinceOccurrence: number | null; consistency: number | null; lastRecorded: string | null };
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

export default function NotToDoPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ title: "", category: "Phone / social media", why: "", triggers: "", replacement: "", emergencyPlan: "", commitment: "" });
  const [checkin, setCheckin] = useState({ date: today(), outcome: "avoided", urges: "0", intensity: "", trigger: "", emotion: "", response: "", whatHelped: "", lesson: "", tomorrow: "" });
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/not-to-do", { cache: "no-store" });
      if (!response.ok) throw new Error("Not To Do rules could not be loaded.");
      const payload = await response.json() as { rules: Rule[] };
      setRules(payload.rules);
      setSelected(current => current || payload.rules[0]?.id || "");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load rules."); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createRule() {
    if (!draft.title.trim()) { setError("Enter the behavior you want to avoid."); return; }
    const response = await fetch("/api/not-to-do", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draft.title, category: draft.category, data: {
        why: draft.why, triggers: draft.triggers.split("\n").filter(Boolean), replacement: draft.replacement,
        emergencyPlan: draft.emergencyPlan.split("\n").filter(Boolean), commitment: draft.commitment,
      } }) });
    if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error ?? "Rule could not be saved."); return; }
    const result = await response.json() as { id: string };
    setSelected(result.id); setDraft({ title: "", category: "Phone / social media", why: "", triggers: "", replacement: "", emergencyPlan: "", commitment: "" });
    setShowForm(false); setMessage("Rule saved. You can check in for today."); await load();
  }

  async function saveCheckin() {
    if (!selected) return;
    const response = await fetch(`/api/not-to-do/${selected}/checkins`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: checkin.date, outcome: checkin.outcome, urges: Number(checkin.urges) || 0,
        intensity: checkin.intensity ? Number(checkin.intensity) : null,
        data: { trigger: checkin.trigger, emotion: checkin.emotion, response: checkin.response, whatHelped: checkin.whatHelped, lesson: checkin.lesson, tomorrow: checkin.tomorrow } }) });
    if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error ?? "Check-in failed."); return; }
    setMessage("Check-in saved. A difficult day does not erase your progress."); await load();
  }

  async function toggleActive(rule: Rule) {
    const response = await fetch(`/api/not-to-do/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !rule.active }) });
    if (!response.ok) { setError("Rule status could not be changed."); return; }
    await load();
  }

  async function archiveRule(rule: Rule) {
    if (!window.confirm(`Archive "${rule.title}"? Its check-in history will be preserved.`)) return;
    const response = await fetch(`/api/not-to-do/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true }) });
    if (!response.ok) { setError("Rule could not be archived."); return; }
    setSelected("");
    setMessage("Rule archived. Its history remains available in exported data.");
    await load();
  }

  return <LifeFrame active="Not To Do" onNavigate={onNavigate}>
    <section className="life-content">
      <header className="life-heading"><div><p className="eyebrow">NOTICE · CHOOSE · RECOVER</p><h1>Not To Do</h1><p>A private, non-judgmental way to understand urges and change unwanted patterns.</p></div><button className="life-primary" onClick={()=>setShowForm(true)}>＋ Add a rule</button></header>
      {error&&<p className="life-error" role="alert">{error}</p>}{message&&<p className="life-message" role="status">{message}</p>}
      {!rules.length?<div className="life-empty"><b>No active rules yet.</b><p>Choose one behavior you want to change. Missing days will never count as a success.</p><button className="life-primary" onClick={()=>setShowForm(true)}>Create a private rule</button></div>:
        <div className="habit-layout"><div className="habit-list">{rules.map(rule=><button key={rule.id} className={`habit-select ${selected===rule.id?"selected":""}`} onClick={()=>setSelected(rule.id)}><b>{rule.title}</b><small>{rule.category} · {rule.active?"Tracking":"Paused"}</small></button>)}</div>
          {rules.filter(rule=>rule.id===selected).map(rule=><article className="habit-card" key={rule.id}>
            <header><div><p className="eyebrow">{rule.category.toUpperCase()}</p><h2>{rule.title}</h2></div><div className="habit-header-actions"><button className="life-secondary" onClick={()=>void toggleActive(rule)}>{rule.active?"Pause tracking":"Resume tracking"}</button><button className="life-secondary" onClick={()=>void archiveRule(rule)}>Archive</button></div></header>
            <div className="life-stats habit-stats"><article><small>Current streak</small><b>{rule.metrics.currentStreak} days</b></article><article><small>Longest streak</small><b>{rule.metrics.longestStreak} days</b></article><article><small>Avoidance consistency</small><b>{rule.metrics.consistency===null?"—":`${rule.metrics.consistency}%`}</b></article><article><small>Urges resisted</small><b>{rule.metrics.totalUrgesResisted}</b></article></div>
            <p className="habit-occurrence">{rule.metrics.lastOccurrence?`${rule.metrics.daysSinceOccurrence} days since last recorded slip`:"No occurrence recorded since tracking started."} · {rule.metrics.slips} slips recorded</p>
            {rule.data.why&&<details><summary>My reasons and support plan</summary><p>{rule.data.why}</p>{(rule.data.triggers?.length??0)>0&&<p><b>Triggers:</b> {rule.data.triggers?.join(", ")}</p>}{rule.data.replacement&&<p><b>Replacement:</b> {rule.data.replacement}</p>}{(rule.data.emergencyPlan?.length??0)>0&&<p><b>Urge plan:</b> {rule.data.emergencyPlan?.join(" → ")}</p>}</details>}
            {rule.active&&<section className="habit-checkin"><h3>Daily check-in</h3><div className="habit-form-grid"><label>Date<input type="date" value={checkin.date} onChange={event=>setCheckin({...checkin,date:event.target.value})}/></label><label>Outcome<select value={checkin.outcome} onChange={event=>setCheckin({...checkin,outcome:event.target.value})}><option value="avoided">Successfully avoided</option><option value="urge_resisted">Urge experienced, resisted</option><option value="slip">Slip — reflect and recover</option><option value="not_applicable">Not applicable</option></select></label><label>Urges today<input type="number" min="0" value={checkin.urges} onChange={event=>setCheckin({...checkin,urges:event.target.value})}/></label><label>Strongest urge (1–10)<input type="number" min="1" max="10" value={checkin.intensity} onChange={event=>setCheckin({...checkin,intensity:event.target.value})}/></label>
              <label>What triggered it?<input value={checkin.trigger} onChange={event=>setCheckin({...checkin,trigger:event.target.value})}/></label><label>Emotional state<input value={checkin.emotion} onChange={event=>setCheckin({...checkin,emotion:event.target.value})}/></label><label>How did you respond?<input value={checkin.response} onChange={event=>setCheckin({...checkin,response:event.target.value})}/></label><label>What helped?<input value={checkin.whatHelped} onChange={event=>setCheckin({...checkin,whatHelped:event.target.value})}/></label><label>What did you learn?<input value={checkin.lesson} onChange={event=>setCheckin({...checkin,lesson:event.target.value})}/></label><label>Tomorrow I will…<input value={checkin.tomorrow} onChange={event=>setCheckin({...checkin,tomorrow:event.target.value})}/></label></div><button className="life-primary" onClick={()=>void saveCheckin()}>Save private check-in</button></section>}
          </article>)}
        </div>}
      {showForm&&<div className="life-modal-backdrop"><section className="life-modal" role="dialog" aria-modal="true" aria-labelledby="habit-title"><div className="life-modal-head"><div><p className="eyebrow">PRIVATE · NO SHAME</p><h2 id="habit-title">Create a Not To Do rule</h2></div><button onClick={()=>setShowForm(false)} aria-label="Close">×</button></div><div className="wizard-fields"><label>Behavior to change<input value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})} placeholder="e.g. Excessive phone use"/></label><label>Category<select value={draft.category} onChange={event=>setDraft({...draft,category:event.target.value})}>{["Phone / social media","Procrastination","Browsing","Gaming","Sleep","Other"].map(item=><option key={item}>{item}</option>)}</select></label><label>Why do I want to stop?<textarea rows={3} value={draft.why} onChange={event=>setDraft({...draft,why:event.target.value})}/></label><label>My triggers (one per line)<textarea rows={3} value={draft.triggers} onChange={event=>setDraft({...draft,triggers:event.target.value})}/></label><label>What will I do instead?<textarea rows={3} value={draft.replacement} onChange={event=>setDraft({...draft,replacement:event.target.value})}/></label><label>Emergency recovery steps (one per line)<textarea rows={3} value={draft.emergencyPlan} onChange={event=>setDraft({...draft,emergencyPlan:event.target.value})}/></label><label>My commitment<textarea rows={2} value={draft.commitment} onChange={event=>setDraft({...draft,commitment:event.target.value})}/></label></div><div className="wizard-actions"><button className="life-secondary" onClick={()=>setShowForm(false)}>Cancel</button><button className="life-primary" onClick={()=>void createRule()}>Save rule</button></div></section></div>}
    </section>
  </LifeFrame>;
}
