"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LifeFrame from "@/app/life-frame";

type Milestone = { id: string; title: string; due_date: string | null; status: string };
type Dependency = { depends_on_goal_id: string; title: string; status: string };
type WeeklyReview = { id: string; week_start: string; data: { wins?: string; blockers?: string; lesson?: string; nextWeek?: string } };
type Goal = {
  id: string; title: string; category: string; priority: string; goal_type: string; status: string;
  start_date: string; target_date: string | null; target_value: number | null; target_unit: string | null;
  current_value: number; is_primary: boolean; data: Record<string, string>; metrics: {
    outcomeProgress: number | null; overachievement: number; executionConsistency: number | null;
    totalHours: number; remainingTarget: number | null; remainingDays: number | null; status: string;
  }; milestones: Milestone[];
};
type Field = { key: string; label: string; type?: "textarea" | "date" | "number" | "select"; options?: string[]; required?: boolean };
type Section = { title: string; fields: Field[] };

const sections: Section[] = [
  { title: "Goal identity", fields: [
    { key: "title", label: "Goal title", required: true }, { key: "description", label: "What do you want to achieve?", type: "textarea" },
    { key: "category", label: "Category", type: "select", options: ["Business", "Financial", "Career", "Education", "Health", "Fitness", "Personal Development", "Religious", "Relationships", "Lifestyle", "Other"], required: true },
    { key: "subcategory", label: "Subcategory" }, { key: "priority", label: "Priority", type: "select", options: ["critical", "high", "medium", "low"] },
    { key: "goalType", label: "Goal type", type: "select", options: ["one_time", "recurring", "continuous", "personal"] },
    { key: "whyMeaningful", label: "Why is this meaningful to you?", type: "textarea" }, { key: "commitment", label: "My commitment", type: "textarea" },
  ] },
  { title: "Purpose & motivation", fields: [
    { key: "why", label: "Why do I want this?", type: "textarea" }, { key: "lifeChange", label: "What will change after achieving it?", type: "textarea" },
    { key: "benefits", label: "Benefits I expect", type: "textarea" }, { key: "futureBenefit", label: "How will it improve my future?", type: "textarea" },
    { key: "whoBenefits", label: "Who else may benefit?", type: "textarea" }, { key: "ifNotAchieved", label: "What if I do not achieve it?", type: "textarea" },
    { key: "commitmentScale", label: "Commitment (1–10)", type: "number" }, { key: "motivationStatement", label: "Motivation statement", type: "textarea" },
  ] },
  { title: "Target & timeline", fields: [
    { key: "startDate", label: "Start date", type: "date" }, { key: "targetDate", label: "Target date / deadline", type: "date" },
    { key: "targetValue", label: "Target value", type: "number" }, { key: "targetUnit", label: "Unit (USD, clients, pages…)" },
    { key: "currentValue", label: "Already achieved", type: "number" }, { key: "minimumOutcome", label: "Minimum acceptable outcome", type: "number" },
    { key: "expectedOutcome", label: "Expected outcome", type: "number" }, { key: "stretchTarget", label: "Stretch target", type: "number" },
    { key: "workingDays", label: "Working days per week", type: "number" }, { key: "weeklyHours", label: "Available weekly hours", type: "number" },
  ] },
  { title: "Define success", fields: [
    { key: "successCriteria", label: "Exact success criteria", type: "textarea" }, { key: "minimumSuccess", label: "Minimum success conditions", type: "textarea" },
    { key: "idealSuccess", label: "Ideal success conditions", type: "textarea" }, { key: "stretchSuccess", label: "Stretch success conditions", type: "textarea" },
    { key: "deliverables", label: "Required deliverables", type: "textarea" }, { key: "verification", label: "How will I verify success?", type: "textarea" },
    { key: "evidence", label: "Evidence / notes", type: "textarea" }, { key: "completionDefinition", label: "Completion definition", type: "textarea" },
  ] },
  { title: "Execution strategy", fields: [
    { key: "strategy", label: "Overall strategy", type: "textarea" }, { key: "steps", label: "Step-by-step approach", type: "textarea" },
    { key: "skills", label: "Skills required / to develop", type: "textarea" }, { key: "resources", label: "Resources and tools", type: "textarea" },
    { key: "budget", label: "Estimated budget", type: "number" }, { key: "people", label: "People involved", type: "textarea" },
    { key: "dependencies", label: "Dependencies / external requirements", type: "textarea" }, { key: "research", label: "Research notes", type: "textarea" },
  ] },
  { title: "Obstacles & solutions", fields: [
    { key: "internalObstacles", label: "Internal obstacles", type: "textarea" }, { key: "externalObstacles", label: "External obstacles", type: "textarea" },
    { key: "distractions", label: "Distractions to avoid", type: "textarea" }, { key: "risks", label: "Risks and failure situations", type: "textarea" },
    { key: "backupPlan", label: "Backup strategy", type: "textarea" }, { key: "ifThen", label: "If–then plan", type: "textarea" },
    { key: "recoveryStrategy", label: "If I fall behind, I will…", type: "textarea" },
  ] },
  { title: "Milestones", fields: [
    { key: "milestoneIdeas", label: "Milestone ideas (one per line; you can edit them after creation)", type: "textarea" },
    { key: "actionItems", label: "First action items", type: "textarea" },
  ] },
  { title: "Daily work requirements", fields: [
    { key: "minimumDailyHours", label: "Minimum daily hours", type: "number" }, { key: "idealDailyHours", label: "Ideal daily hours", type: "number" },
    { key: "maximumDailyHours", label: "Maximum daily hours", type: "number" }, { key: "preferredTime", label: "Preferred working time" },
    { key: "dailyTasks", label: "Daily tasks / output targets", type: "textarea" }, { key: "weeklyTargets", label: "Weekly targets", type: "textarea" },
    { key: "nonNegotiableAction", label: "Minimum non-negotiable action", type: "textarea" }, { key: "restDays", label: "Rest days" },
    { key: "preferredLocation", label: "Preferred work location" },
  ] },
  { title: "Daily tracking & accountability", fields: [
    { key: "dailyTarget", label: "Today's commitment / target", type: "textarea" },
    { key: "accountability", label: "Who or what keeps me accountable?", type: "textarea" },
    { key: "checkinReminder", label: "Preferred daily check-in time" },
  ] },
  { title: "Review & improvement", fields: [
    { key: "weeklyReviewDay", label: "Weekly review day" }, { key: "weeklyCommitment", label: "Weekly commitment", type: "textarea" },
    { key: "nextReviewDate", label: "Next review date", type: "date" }, { key: "reviewNotes", label: "Review notes", type: "textarea" },
  ] },
];

const emptyDraft: Record<string, string> = { category: "Personal Development", priority: "medium", goalType: "one_time" };
const statusNames: Record<string, string> = {
  not_started: "Not started", active: "Active", on_track: "On track", at_risk: "At risk",
  behind_schedule: "Behind schedule", paused: "Paused", completed: "Completed", cancelled: "Cancelled", overdue: "Overdue",
};

export default function GoalsPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>(emptyDraft);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [checkin, setCheckin] = useState({ hours: "1", outputValue: "", targetMet: "true", worked: true, note: "" });
  const [weeklyReview, setWeeklyReview] = useState({ wins: "", blockers: "", lesson: "", nextWeek: "" });
  const [dependencyChoice, setDependencyChoice] = useState("");
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [weeklyReviews, setWeeklyReviews] = useState<WeeklyReview[]>([]);
  const [rescueNote, setRescueNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/goals", { cache: "no-store" });
      if (!response.ok) throw new Error("Goals could not be loaded.");
      const payload = await response.json() as { goals: Goal[] };
      setGoals(payload.goals); setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Goals could not be loaded.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
      try {
        const saved = localStorage.getItem("cc-goal-draft-v2");
        if (saved) setDraft({ ...emptyDraft, ...JSON.parse(saved) as Record<string, string> });
      } catch { setError("Saved goal draft could not be read."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!expanded) return;
    const timer = window.setTimeout(async () => {
      try {
        const [dependencyResponse, reviewResponse] = await Promise.all([
          fetch(`/api/goals/${expanded}/dependencies`, { cache: "no-store" }),
          fetch(`/api/goals/${expanded}/reviews`, { cache: "no-store" }),
        ]);
        if (!dependencyResponse.ok || !reviewResponse.ok) throw new Error("Goal history could not be loaded.");
        const dependencyPayload = await dependencyResponse.json() as { dependencies: Dependency[] };
        const reviewPayload = await reviewResponse.json() as { reviews: WeeklyReview[] };
        setDependencies(dependencyPayload.dependencies);
        setWeeklyReviews(reviewPayload.reviews);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Goal history could not be loaded."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  const visibleGoals = useMemo(() => goals.filter(goal => {
    if (filter === "all") return true;
    if (filter === "active") return !["paused", "completed", "cancelled", "overdue"].includes(goal.metrics.status);
    if (filter === "at-risk") return ["at_risk", "behind_schedule", "overdue"].includes(goal.metrics.status);
    return goal.metrics.status === filter;
  }), [filter, goals]);

  const updateDraft = (key: string, value: string) => setDraft(current => {
    const updated = { ...current, [key]: value };
    localStorage.setItem("cc-goal-draft-v2", JSON.stringify(updated));
    return updated;
  });

  async function createGoal() {
    if (!draft.title?.trim() || !draft.category) { setError("Goal title and category are required."); return; }
    const response = await fetch("/api/goals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title, category: draft.category, priority: draft.priority, goalType: draft.goalType,
        startDate: draft.startDate, targetDate: draft.targetDate || null, targetValue: draft.targetValue ? Number(draft.targetValue) : null,
        targetUnit: draft.targetUnit, currentValue: draft.currentValue ? Number(draft.currentValue) : 0,
        isPrimary: goals.length === 0, data: draft,
      }),
    });
    if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error ?? "Goal could not be saved."); return; }
    const result = await response.json() as { id: string };
    const milestoneIdeas = (draft.milestoneIdeas ?? "").split("\n").map(line => line.trim()).filter(Boolean);
    for (const title of milestoneIdeas) {
      await fetch(`/api/goals/${result.id}/milestones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    }
    setDraft(emptyDraft); localStorage.removeItem("cc-goal-draft-v2");
    setWizardOpen(false); setStep(0); setMessage("Goal saved."); await load();
  }

  async function patchGoal(goal: Goal, update: Record<string, unknown>) {
    const response = await fetch(`/api/goals/${goal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) });
    if (!response.ok) { setError("Goal update failed."); return; }
    await load();
  }

  async function saveMilestone(goal: Goal) {
    if (!milestoneTitle.trim()) return;
    const response = await fetch(`/api/goals/${goal.id}/milestones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: milestoneTitle }) });
    if (!response.ok) { setError("Milestone could not be saved."); return; }
    setMilestoneTitle(""); await load();
  }

  async function saveCheckin(goal: Goal) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    const response = await fetch(`/api/goals/${goal.id}/checkins`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: today, worked: checkin.worked, hours: Number(checkin.hours) || 0,
        outputValue: checkin.outputValue ? Number(checkin.outputValue) : null,
        targetMet: checkin.targetMet === "" ? null : checkin.targetMet === "true",
        data: { note: checkin.note, tasks: [] } }),
    });
    if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error ?? "Daily check-in could not be saved."); return; }
    setMessage("Daily goal check-in saved."); await load();
  }

  async function saveWeeklyReview(goal: Goal) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    const weekStartDate = new Date(`${today}T00:00:00Z`);
    weekStartDate.setUTCDate(weekStartDate.getUTCDate() - ((weekStartDate.getUTCDay() + 6) % 7));
    const weekStart = weekStartDate.toISOString().slice(0, 10);
    const response = await fetch(`/api/goals/${goal.id}/reviews`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart, data: weeklyReview }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Weekly review could not be saved."); return; }
    setWeeklyReview({ wins: "", blockers: "", lesson: "", nextWeek: "" });
    setMessage(`Weekly review saved for week starting ${weekStart}.`);
    const reviewsResponse = await fetch(`/api/goals/${goal.id}/reviews`, { cache: "no-store" });
    if (reviewsResponse.ok) setWeeklyReviews((await reviewsResponse.json() as { reviews: WeeklyReview[] }).reviews);
  }

  async function completeGoal(goal: Goal) {
    const reflection = window.prompt("Completion review: what did you achieve, and what evidence confirms it?");
    if (reflection === null) return;
    await patchGoal(goal, {
      status: "completed",
      data: { ...goal.data, completionReview: reflection.trim(), completedAt: new Date().toISOString() },
    });
  }

  async function saveRescuePlan(goal: Goal) {
    if (!rescueNote.trim()) { setError("Write one small next action for this goal."); return; }
    await patchGoal(goal, {
      data: { ...goal.data, lastRescueAction: rescueNote.trim(), lastRescueAt: new Date().toISOString() },
    });
    setRescueNote("");
    setMessage("Rescue action saved. Start with this one manageable next step.");
  }

  async function addDependency(goal: Goal) {
    if (!dependencyChoice) return;
    const response = await fetch(`/api/goals/${goal.id}/dependencies`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dependsOnGoalId: dependencyChoice }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Dependency could not be added."); return; }
    setDependencyChoice("");
    const refreshed = await fetch(`/api/goals/${goal.id}/dependencies`, { cache: "no-store" });
    if (refreshed.ok) setDependencies((await refreshed.json() as { dependencies: Dependency[] }).dependencies);
  }

  async function removeDependency(goal: Goal, dependency: Dependency) {
    const response = await fetch(`/api/goals/${goal.id}/dependencies?goalId=${encodeURIComponent(dependency.depends_on_goal_id)}`, { method: "DELETE" });
    if (!response.ok) { setError("Dependency could not be removed."); return; }
    setDependencies(current => current.filter(item => item.depends_on_goal_id !== dependency.depends_on_goal_id));
  }

  const counts = {
    total: goals.length,
    active: goals.filter(goal => !["paused", "completed", "cancelled"].includes(goal.metrics.status)).length,
    atRisk: goals.filter(goal => ["at_risk", "behind_schedule", "overdue"].includes(goal.metrics.status)).length,
    completed: goals.filter(goal => goal.status === "completed").length,
  };

  return <LifeFrame active="Goals" onNavigate={onNavigate}>
    <section className="life-content">
      <header className="life-heading"><div><p className="eyebrow">PLAN → EXECUTE → IMPROVE</p><h1>Your goals</h1><p>Big outcomes, broken down into manageable daily actions.</p></div><button className="life-primary" onClick={() => { setWizardOpen(true); setError(""); }}>＋ Add goal</button></header>
      {error && <p className="life-error" role="alert">{error}</p>}{message && <p className="life-message" role="status">{message}</p>}
      <div className="life-stats"><article><small>Total goals</small><b>{counts.total}</b></article><article><small>Active</small><b>{counts.active}</b></article><article><small>At risk</small><b>{counts.atRisk}</b></article><article><small>Completed</small><b>{counts.completed}</b></article></div>
      <div className="life-toolbar"><div className="life-filters">{[["all","All"],["active","Active"],["at-risk","At risk"],["paused","Paused"],["completed","Completed"],["overdue","Overdue"]].map(([key,label])=><button key={key} className={filter===key?"selected":""} onClick={()=>setFilter(key)}>{label}</button>)}</div><span>{loading?"Loading…":`${visibleGoals.length} goals`}</span></div>
      {loading ? <p className="life-empty">Loading goals…</p> : visibleGoals.length === 0 ? <div className="life-empty"><b>No goals here yet.</b><p>Create a goal to define its target and first daily action.</p><button className="life-primary" onClick={()=>setWizardOpen(true)}>Create a goal</button></div> :
        <div className="goal-grid">{visibleGoals.map(goal=><article className="goal-card" key={goal.id}>
          <div className="goal-card-head"><span className={`goal-status ${goal.metrics.status}`}>{statusNames[goal.metrics.status] ?? goal.metrics.status}</span><button aria-label="Set as primary focus" title="Set as primary focus" onClick={()=>void patchGoal(goal,{isPrimary:true})}>{goal.is_primary?"★":"☆"}</button></div>
          <p className="eyebrow">{goal.category.toUpperCase()} · {goal.priority.toUpperCase()}</p><h2>{goal.title}</h2>
          <p className="goal-target">{goal.target_value !== null ? `${goal.current_value} / ${goal.target_value} ${goal.target_unit ?? ""}` : "Progress tracked through daily actions"}</p>
          {goal.metrics.outcomeProgress !== null&&<><div className="goal-progress"><i style={{width:`${Math.min(100,goal.metrics.outcomeProgress)}%`}}/></div><small>{goal.metrics.outcomeProgress}% outcome progress{goal.metrics.overachievement?` · +${goal.metrics.overachievement}% over target`:""}</small></>}
          <div className="goal-metrics"><span>Execution consistency <b>{goal.metrics.executionConsistency===null?"—":`${goal.metrics.executionConsistency}%`}</b></span><span>Time invested <b>{goal.metrics.totalHours}h</b></span><span>Deadline <b>{goal.target_date??"No deadline"}</b></span></div>
          {goal.is_primary&&<span className="primary-focus-tag">PRIMARY FOCUS</span>}
          <div className="goal-actions"><button onClick={()=>setExpanded(expanded===goal.id?"":goal.id)}>{expanded===goal.id?"Close":"Details & check-in"}</button>{goal.status==="completed"?<button onClick={()=>void patchGoal(goal,{status:"active"})}>Reopen</button>:goal.status==="cancelled"?<button onClick={()=>void patchGoal(goal,{status:"active"})}>Restart</button>:<><button onClick={()=>void patchGoal(goal,{status:goal.status==="paused"?"active":"paused"})}>{goal.status==="paused"?"Resume":"Pause"}</button><button onClick={()=>void completeGoal(goal)}>Complete & review</button></>}<button onClick={()=>{if(window.confirm("Archive this goal? Its history will be preserved."))void fetch(`/api/goals/${goal.id}`,{method:"DELETE"}).then(()=>load());}}>Archive</button></div>
          {expanded===goal.id&&<div className="goal-detail">
            {goal.data.motivationStatement&&<blockquote>{goal.data.motivationStatement}</blockquote>}
            {["at_risk","behind_schedule","overdue"].includes(goal.metrics.status)&&<section className="goal-rescue"><h3>Rescue this goal</h3>{goal.data.recoveryStrategy&&<p>{goal.data.recoveryStrategy}</p>}{goal.data.lastRescueAction&&<small>Last next step: {goal.data.lastRescueAction}</small>}<label>One small action to get moving<textarea rows={2} value={rescueNote} onChange={event=>setRescueNote(event.target.value)} placeholder="Make the next step specific and manageable"/></label><button className="life-secondary" onClick={()=>void saveRescuePlan(goal)}>Save rescue action</button></section>}
            <h3>Milestones</h3>{goal.milestones.map(milestone=><label className="milestone-row" key={milestone.id}><input type="checkbox" checked={milestone.status==="completed"} onChange={event=>void fetch(`/api/goals/${goal.id}/milestones`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:milestone.id,completed:event.target.checked})}).then(load)}/>{milestone.title}{milestone.due_date&&<small>{milestone.due_date}</small>}</label>)}
            <div className="inline-form"><input aria-label="New milestone" placeholder="Add milestone" value={milestoneTitle} onChange={event=>setMilestoneTitle(event.target.value)} onKeyDown={event=>event.key==="Enter"&&void saveMilestone(goal)}/><button onClick={()=>void saveMilestone(goal)}>Add</button></div>
            <h3>Goal dependencies</h3>{dependencies.map(dependency=><div className="dependency-row" key={dependency.depends_on_goal_id}><span>{dependency.title} · {dependency.status}</span><button aria-label={`Remove dependency ${dependency.title}`} onClick={()=>void removeDependency(goal,dependency)}>Remove</button></div>)}<div className="inline-form"><select aria-label="Goal this depends on" value={dependencyChoice} onChange={event=>setDependencyChoice(event.target.value)}><option value="">Choose a prerequisite goal</option>{goals.filter(item=>item.id!==goal.id&&!dependencies.some(dependency=>dependency.depends_on_goal_id===item.id)).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><button disabled={!dependencyChoice} onClick={()=>void addDependency(goal)}>Add dependency</button></div>
            <h3>Today&apos;s check-in</h3><div className="goal-checkin"><label><input type="checkbox" checked={checkin.worked} onChange={event=>setCheckin({...checkin,worked:event.target.checked})}/> Worked on goal</label><label>Hours<input type="number" min="0" max="24" step="0.25" value={checkin.hours} onChange={event=>setCheckin({...checkin,hours:event.target.value})}/></label><label>Output today<input type="number" min="0" value={checkin.outputValue} onChange={event=>setCheckin({...checkin,outputValue:event.target.value})}/></label><label>Daily target<select value={checkin.targetMet} onChange={event=>setCheckin({...checkin,targetMet:event.target.value})}><option value="">Not set</option><option value="true">Met</option><option value="false">Not met</option></select></label><label>Notes<input value={checkin.note} onChange={event=>setCheckin({...checkin,note:event.target.value})}/></label><button onClick={()=>void saveCheckin(goal)}>Save check-in</button></div>
            <section className="goal-weekly-review"><h3>Weekly review</h3>{weeklyReviews.slice(0,2).map(review=><details key={review.id}><summary>Week of {review.week_start}</summary><p><b>Wins:</b> {review.data.wins||"—"}</p><p><b>Blockers:</b> {review.data.blockers||"—"}</p><p><b>Lesson:</b> {review.data.lesson||"—"}</p><p><b>Next:</b> {review.data.nextWeek||"—"}</p></details>)}<label>What went well?<textarea value={weeklyReview.wins} onChange={event=>setWeeklyReview({...weeklyReview,wins:event.target.value})}/></label><label>What got in the way?<textarea value={weeklyReview.blockers} onChange={event=>setWeeklyReview({...weeklyReview,blockers:event.target.value})}/></label><label>What did I learn?<textarea value={weeklyReview.lesson} onChange={event=>setWeeklyReview({...weeklyReview,lesson:event.target.value})}/></label><label>Next week&apos;s commitment<textarea value={weeklyReview.nextWeek} onChange={event=>setWeeklyReview({...weeklyReview,nextWeek:event.target.value})}/></label><button className="life-secondary" onClick={()=>void saveWeeklyReview(goal)}>Save this week&apos;s review</button></section>
          </div>}
        </article>)}</div>}
      {wizardOpen&&<div className="life-modal-backdrop"><section className="life-modal" role="dialog" aria-modal="true" aria-labelledby="goal-wizard-title"><div className="life-modal-head"><div><p className="eyebrow">GOAL SETUP · STEP {step+1} OF {sections.length}</p><h2 id="goal-wizard-title">{sections[step].title}</h2></div><button aria-label="Close" onClick={()=>setWizardOpen(false)}>×</button></div><div className="wizard-progress"><i style={{width:`${(step+1)/sections.length*100}%`}}/></div><div className="wizard-fields">{sections[step].fields.map(field=><label key={field.key}>{field.label}{field.type==="textarea"?<textarea rows={3} value={draft[field.key]??""} onChange={event=>updateDraft(field.key,event.target.value)}/>:field.type==="select"?<select value={draft[field.key]??field.options?.[0]??""} onChange={event=>updateDraft(field.key,event.target.value)}>{field.options?.map(option=><option key={option} value={option}>{option.replaceAll("_"," ")}</option>)}</select>:<input type={field.type??"text"} min={field.type==="number"?"0":undefined} value={draft[field.key]??""} onChange={event=>updateDraft(field.key,event.target.value)} required={field.required}/>}</label>)}</div><div className="wizard-actions"><button onClick={()=>{localStorage.setItem("cc-goal-draft-v2",JSON.stringify(draft));setMessage("Draft saved on this device.");}} className="life-secondary">Save draft</button><span>{step+1} / {sections.length}</span>{step>0&&<button className="life-secondary" onClick={()=>setStep(step-1)}>Back</button>}{step<sections.length-1?<button className="life-primary" onClick={()=>setStep(step+1)}>Next</button>:<button className="life-primary" onClick={()=>void createGoal()}>Create goal</button>}</div></section></div>}
    </section>
  </LifeFrame>;
}
