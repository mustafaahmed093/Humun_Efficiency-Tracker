"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LifeFrame from "@/app/life-frame";
import PlanPage from "@/app/plan-page";
import { formatDay, getPlanDays, getSchedule, weekdayName } from "@/lib/schedule";

type Activity = { id: string; title: string; start_time: string | null; end_time: string | null; category: string; priority: string; goal_id: string | null; milestone_id: string | null; status: string; position: number; actual_duration: number | null; data: Record<string, unknown> };
type Goal = { id: string; title: string; status: string };
type Template = { id: string; title: string; activities: Activity[] };
const categories = ["Business", "Work", "Study", "Health", "Fitness", "Religious", "Family", "Personal", "Sleep", "Other"];
const statuses = ["planned", "completed", "partial", "missed", "rescheduled"];
const currentDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const timeMinutes = (time: string | null) => !time ? 0 : time === "24:00" ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const duration = (item: Activity) => {
  if (!item.start_time || !item.end_time) return 0;
  const end = timeMinutes(item.end_time);
  const start = timeMinutes(item.start_time);
  return (end <= start ? end + 1440 : end) - start;
};

export default function PlannerPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [date, setDate] = useState(currentDate());
  const [activities, setActivities] = useState<Activity[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [blueprintDay, setBlueprintDay] = useState(getPlanDays()[0]);
  const [templateTitle, setTemplateTitle] = useState("");
  const [applyTemplateId, setApplyTemplateId] = useState("");
  const [applyMode, setApplyMode] = useState("merge");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showBlueprintReports, setShowBlueprintReports] = useState(false);
  const [dragId, setDragId] = useState("");
  const [form, setForm] = useState({ title: "", description: "", startTime: "09:00", endTime: "10:00", category: "Work", priority: "medium", goalId: "", location: "", notes: "" });

  const load = useCallback(async () => {
    try {
      const [planResponse, goalResponse, templatesResponse] = await Promise.all([
        fetch(`/api/planner?date=${date}`, { cache: "no-store" }),
        fetch("/api/goals", { cache: "no-store" }),
        fetch("/api/planner/templates", { cache: "no-store" }),
      ]);
      if (!planResponse.ok || !goalResponse.ok || !templatesResponse.ok) throw new Error("Planner data could not be loaded.");
      const plan = await planResponse.json() as { activities: Activity[] };
      const goalData = await goalResponse.json() as { goals: Goal[] };
      const templateData = await templatesResponse.json() as { templates: Template[] };
      setActivities(plan.activities); setGoals(goalData.goals.filter(goal=>!["completed","cancelled"].includes(goal.status)));
      setTemplates(templateData.templates); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Planner data could not be loaded."); }
  }, [date]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const blueprint = useMemo(() => getSchedule(blueprintDay), [blueprintDay]);
  const summary = useMemo(() => activities.reduce((value, item) => {
    const minutes = duration(item);
    value.total += minutes;
    value.categories[item.category] = (value.categories[item.category] ?? 0) + minutes;
    return value;
  }, { total: 0, categories: {} as Record<string, number> }), [activities]);

  async function addActivity(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/planner", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, title: form.title, startTime: form.startTime, endTime: form.endTime, category: form.category, priority: form.priority, goalId: form.goalId || null,
        data: { description: form.description, location: form.location, notes: form.notes } }) });
    const result = await response.json() as { error?: string; conflicts?: unknown[] };
    if (!response.ok) { setError(result.error ?? "Activity could not be saved."); return; }
    setForm({ ...form, title: "", description: "", location: "", notes: "" });
    setMessage(result.conflicts?.length ? "Activity saved. There is an overlapping block; review the schedule." : "Activity added.");
    await load();
  }

  async function changeActivity(activity: Activity, update: Record<string, unknown>) {
    const response = await fetch(`/api/planner/${activity.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) });
    const result = await response.json() as { error?: string; conflicts?: unknown[] };
    if (!response.ok) { setError(result.error ?? "Activity update failed."); return; }
    setMessage(result.conflicts?.length ? "Updated. One or more time overlaps need attention." : "Schedule updated.");
    await load();
  }

  async function applyBlueprint() {
    const response = await fetch("/api/planner", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply-blueprint", date, blueprintDay }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Blueprint could not be applied."); return; }
    setMessage("Blueprint applied as a dated plan; the original routine and past records were left unchanged."); await load();
  }

  async function saveTemplate() {
    if (!templateTitle.trim()) { setError("Enter a template name."); return; }
    const response = await fetch("/api/planner/templates", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: templateTitle, date }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Template could not be saved."); return; }
    setTemplateTitle(""); setMessage("Daily template saved."); await load();
  }

  async function applyTemplate() {
    if (!applyTemplateId) return;
    const response = await fetch(`/api/planner/templates/${applyTemplateId}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, mode: applyMode }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Template could not be applied."); return; }
    setMessage("Template applied to this date."); await load();
  }

  async function deleteTemplate() {
    if (!applyTemplateId || !window.confirm("Delete this template? Existing dated plans will not change.")) return;
    const response = await fetch(`/api/planner/templates?id=${encodeURIComponent(applyTemplateId)}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Template could not be deleted."); return; }
    setApplyTemplateId("");
    setMessage("Template deleted.");
    await load();
  }

  async function moveActivity(dropId: string) {
    const reordered = [...activities];
    const draggedIndex = reordered.findIndex(item=>item.id===dragId);
    const dropIndex = reordered.findIndex(item=>item.id===dropId);
    if (draggedIndex<0||dropIndex<0||draggedIndex===dropIndex) return;
    const [dragged] = reordered.splice(draggedIndex,1); reordered.splice(dropIndex,0,dragged);
    const responses = await Promise.all(reordered.map((item, index) => fetch(`/api/planner/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: index }),
    })));
    const failedResponse = responses.find(response => !response.ok);
    if (failedResponse) {
      const result = await failedResponse.json() as { error?: string };
      setError(result.error ?? "Activities could not be reordered.");
      await load();
      return;
    }
    setMessage("Schedule order updated.");
    await load();
    setDragId("");
  }

  if (showBlueprintReports) return <PlanPage onNavigate={onNavigate} onDaySelect={day=>{setDate(day);setShowBlueprintReports(false);}}/>;
  return <LifeFrame active="Plan a Day" onNavigate={onNavigate}>
    <section className="life-content">
      <header className="life-heading"><div><p className="eyebrow">INTENTION → TIME → EXECUTION</p><h1>Plan a day</h1><p>Plan a custom day, reuse a routine, and keep actual execution separate from the plan.</p></div><label className="date-picker-label">Selected date<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label></header>
      {error&&<p className="life-error" role="alert">{error}</p>}{message&&<p className="life-message" role="status">{message}</p>}
      <div className="planner-summary"><div><b>{weekdayName(date)}, {formatDay(date)}</b><small>{activities.length} planned activities · {Math.floor(summary.total/60)}h {summary.total%60}m assigned</small></div>{Object.entries(summary.categories).map(([category,minutes])=><span key={category}>{category}: {Math.floor(minutes/60)}h {minutes%60}m</span>)}</div>
      <div className="planner-columns"><section className="planner-panel"><h2>Build your schedule</h2><form className="planner-form" onSubmit={event=>void addActivity(event)}>
        <label>Activity<input required maxLength={200} value={form.title} onChange={event=>setForm({...form,title:event.target.value})} placeholder="What will you do?"/></label>
        <label>Category<select value={form.category} onChange={event=>setForm({...form,category:event.target.value})}>{categories.map(item=><option key={item}>{item}</option>)}</select></label>
        <label>Start<input type="time" value={form.startTime} onChange={event=>setForm({...form,startTime:event.target.value})}/></label><label>End<input type="time" value={form.endTime} onChange={event=>setForm({...form,endTime:event.target.value})}/></label>
        <label>Priority<select value={form.priority} onChange={event=>setForm({...form,priority:event.target.value})}>{["critical","high","medium","low"].map(item=><option key={item}>{item}</option>)}</select></label>
        <label>Related goal<select value={form.goalId} onChange={event=>setForm({...form,goalId:event.target.value})}><option value="">No linked goal</option>{goals.map(goal=><option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
        <label className="planner-wide">Description<input value={form.description} onChange={event=>setForm({...form,description:event.target.value})}/></label>
        <label>Location<input value={form.location} onChange={event=>setForm({...form,location:event.target.value})}/></label><label>Notes<input value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})}/></label>
        <button className="life-primary planner-wide">Add to this day</button>
      </form></section>
      <section className="planner-panel"><h2>Use a reusable plan</h2><div className="planner-subsection"><h3>15-day routine blueprint</h3><div className="planner-inline"><label>Preview day<select value={blueprintDay} onChange={event=>setBlueprintDay(event.target.value)}>{getPlanDays().map((day,index)=><option key={day} value={day}>Day {index+1} · {day}</option>)}</select></label><button className="life-secondary" onClick={()=>void applyBlueprint()}>Apply to selected date</button></div><div className="blueprint-preview">{blueprint.slice(0,5).map(block=><p key={block.id}><b>{block.start}–{block.end}</b> {block.name}</p>)}{blueprint.length>5&&<small>+ {blueprint.length-5} more blocks</small>}</div></div>
        <div className="planner-subsection"><h3>Save / reuse a daily template</h3><div className="planner-inline"><input placeholder="Template name" value={templateTitle} onChange={event=>setTemplateTitle(event.target.value)}/><button className="life-secondary" onClick={()=>void saveTemplate()}>Save this day</button></div><div className="planner-inline"><select value={applyTemplateId} onChange={event=>setApplyTemplateId(event.target.value)}><option value="">Choose template</option>{templates.map(template=><option key={template.id} value={template.id}>{template.title}</option>)}</select><select value={applyMode} onChange={event=>setApplyMode(event.target.value)}><option value="merge">Merge into day</option><option value="replace">Replace unexecuted plan</option></select><button className="life-secondary" onClick={()=>void applyTemplate()}>Apply</button><button className="life-secondary" disabled={!applyTemplateId} onClick={()=>void deleteTemplate()}>Delete</button></div></div>
        <button className="planner-link" onClick={()=>setShowBlueprintReports(true)}>Open 15-day blueprint history, reports & import/export →</button>
      </section></div>
      <section className="planner-panel planner-activities"><h2>Today&apos;s activities</h2>{!activities.length?<p className="life-empty">No dated activities. Add a block or apply a routine above.</p>:activities.map(activity=><article className="activity-row" key={activity.id} draggable onDragStart={()=>setDragId(activity.id)} onDragOver={event=>event.preventDefault()} onDrop={()=>void moveActivity(activity.id)}>
        <span className="drag-handle" title="Drag to reorder">⠿</span><div className="activity-time"><input aria-label={`Start time for ${activity.title}`} type="time" defaultValue={activity.start_time??""} onBlur={event=>{if(event.target.value!== (activity.start_time??""))void changeActivity(activity,{startTime:event.target.value||null});}}/><input aria-label={`End time for ${activity.title}`} type="time" defaultValue={activity.end_time==="24:00"?"":activity.end_time??""} onBlur={event=>{const old=activity.end_time==="24:00"?"":activity.end_time??"";if(event.target.value!==old)void changeActivity(activity,{endTime:event.target.value||null});}}/><small>{Math.floor(duration(activity)/60)}h {duration(activity)%60}m</small></div><div className="activity-title"><span>{activity.category} · {activity.priority}</span><input aria-label={`Title for ${activity.title}`} defaultValue={activity.title} onBlur={event=>{if(event.target.value.trim()&&event.target.value!==activity.title)void changeActivity(activity,{title:event.target.value});}}/>{activity.goal_id&&<small>Linked to a goal</small>}</div>
        <select aria-label={`Status for ${activity.title}`} value={activity.status} onChange={event=>void changeActivity(activity,{status:event.target.value})}>{statuses.map(status=><option key={status} value={status}>{status}</option>)}</select>
        <input aria-label="Actual duration in minutes" type="number" min="0" placeholder="Actual min" value={activity.actual_duration===null?"":String(activity.actual_duration)} onChange={event=>void changeActivity(activity,{actualDuration:event.target.value===""?null:Number(event.target.value)})}/>
        <button aria-label={`Delete ${activity.title}`} onClick={()=>{if(window.confirm("Delete this planned activity?"))void fetch(`/api/planner/${activity.id}`,{method:"DELETE"}).then(load);}}>×</button>
      </article>)}</section>
    </section>
  </LifeFrame>;
}
