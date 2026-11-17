"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LifeFrame from "@/app/life-frame";
import PlanPage from "@/app/plan-page";
import { addPlannerDays, getPlannerDurationMinutes, getPlannerWeekDates } from "@/lib/planner";
import { formatDay, getPlanDays, getSchedule, weekdayName } from "@/lib/schedule";

type Activity = {
  id: string;
  plan_date: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  category: string;
  priority: string;
  goal_id: string | null;
  milestone_id: string | null;
  status: string;
  position: number;
  actual_duration: number | null;
  actual_start: string | null;
  actual_end: string | null;
  data: Record<string, unknown>;
};
type Goal = { id: string; title: string; status: string; milestones?: { id: string; title: string }[] };
type Template = { id: string; title: string; activities: Activity[] };
type Conflict = { first: string; second: string };
type PlannerView = "day" | "week" | "agenda";
type ActivityDraft = {
  date: string;
  endDate: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  category: string;
  priority: string;
  goalId: string;
  milestoneId: string;
  location: string;
  notes: string;
  recurrenceEndDate: string;
  status: string;
  actualDuration: string;
};
type PendingRecurrence = { recurrenceId: string; date: string; title: string; existing: { id: string; title: string }[] };

const categories = ["Business", "Work", "Study", "Health", "Fitness", "Religious", "Family", "Personal", "Sleep", "Other"];
const statuses = ["planned", "completed", "partial", "missed", "rescheduled"];
const categoryColors: Record<string, string> = {
  Business: "#6784d8", Work: "#587bbf", Study: "#8a70ce", Health: "#54a47b", Fitness: "#4c9c96",
  Religious: "#ab8752", Family: "#d17e91", Personal: "#8c98a2", Sleep: "#65748f", Other: "#969c9b",
};
const currentDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const timeMinutes = (time: string | null) => !time ? 0 : time === "24:00" ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const pad = (value: number) => String(value).padStart(2, "0");
const formatTime = (time: string | null) => !time ? "Any time" : time === "24:00" ? "12:00 AM" : new Date(`2000-01-01T${time}:00Z`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const emptyDraft = (date: string): ActivityDraft => ({
  date, endDate: date, title: "", description: "", startTime: "09:00", endTime: "10:00", category: "Work",
  priority: "medium", goalId: "", milestoneId: "", location: "", notes: "", recurrenceEndDate: "", status: "planned", actualDuration: "",
});
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const recurrenceIdOf = (activity: Activity) => typeof activity.data.recurrenceId === "string" ? activity.data.recurrenceId : null;

function activityDuration(activity: Activity) {
  const endDate = typeof activity.data.endDate === "string" ? activity.data.endDate : activity.plan_date;
  return getPlannerDurationMinutes(activity.plan_date, activity.start_time, endDate, activity.end_time) ?? 0;
}

function hoursLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function PlannerPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [date, setDate] = useState(currentDate());
  const today = currentDate();
  const [view, setView] = useState<PlannerView>("agenda");
  const [plans, setPlans] = useState<Record<string, { activities: Activity[]; conflicts: Conflict[] }>>({});
  const [goals, setGoals] = useState<Goal[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [blueprintDay, setBlueprintDay] = useState(getPlanDays()[0]);
  const [templateTitle, setTemplateTitle] = useState("");
  const [applyTemplateId, setApplyTemplateId] = useState("");
  const [applyMode, setApplyMode] = useState("merge");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showBlueprintReports, setShowBlueprintReports] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [form, setForm] = useState<ActivityDraft>(emptyDraft(date));
  const [recurrenceScope, setRecurrenceScope] = useState("only");
  const [dragId, setDragId] = useState("");
  const [repeatActivity, setRepeatActivity] = useState<{ id: string; date: string } | null>(null);
  const [repeatMode, setRepeatMode] = useState<"single" | "weekly" | "custom">("single");
  const [repeatEndDate, setRepeatEndDate] = useState("");
  const [customDateInput, setCustomDateInput] = useState("");
  const [customDates, setCustomDates] = useState<string[]>([]);
  const [repeatConflicts, setRepeatConflicts] = useState<{ date: string; activities: string[] }[]>([]);
  const [pendingRecurrence, setPendingRecurrence] = useState<PendingRecurrence | null>(null);

  const weekAnchor = date < today ? today : date;
  const weekDates = useMemo(() => getPlannerWeekDates(weekAnchor).filter(item => item >= today), [weekAnchor, today]);
  const agendaDates = useMemo(() => {
    const start = date < today ? today : date;
    return Array.from({ length: 14 }, (_, index) => addPlannerDays(start, index)).filter((item): item is string => item !== null);
  }, [date, today]);
  const visibleDates = useMemo(() => view === "day" ? [date] : view === "week" ? weekDates : agendaDates, [agendaDates, date, view, weekDates]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [goalResponse, templateResponse, ...planResults] = await Promise.all([
        fetch("/api/goals", { cache: "no-store" }),
        fetch("/api/planner/templates", { cache: "no-store" }),
        ...visibleDates.map(async planDate => {
          const recurrenceResponse = await fetch(`/api/planner/recurrence?date=${planDate}`, { cache: "no-store" });
          if (!recurrenceResponse.ok) throw new Error("Recurring schedules could not be loaded.");
          const recurrenceData = await recurrenceResponse.json() as { pending?: PendingRecurrence[] };
          const planResponse = await fetch(`/api/planner?date=${planDate}`, { cache: "no-store" });
          if (!planResponse.ok) throw new Error("Planner data could not be loaded.");
          const plan = await planResponse.json() as { activities: Activity[]; conflicts: Conflict[] };
          return { date: planDate, activities: plan.activities, conflicts: plan.conflicts, pending: recurrenceData.pending ?? [] };
        }),
      ]);
      if (!goalResponse.ok || !templateResponse.ok) throw new Error("Planner data could not be loaded.");
      const goalData = await goalResponse.json() as { goals: Goal[] };
      const templateData = await templateResponse.json() as { templates: Template[] };
      const nextPlans = Object.fromEntries(planResults.map(result => [result.date, { activities: result.activities, conflicts: result.conflicts }]));
      setPlans(current => ({ ...current, ...nextPlans }));
      setGoals(goalData.goals.filter(goal => !["completed", "cancelled"].includes(goal.status)));
      setTemplates(templateData.templates);
      setPendingRecurrence(planResults.flatMap(result => result.pending)[0] ?? null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Planner data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [visibleDates]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedPlan = plans[date] ?? { activities: [], conflicts: [] };
  const summary = useMemo(() => {
    const items = selectedPlan.activities;
    const total = items.reduce((sum, item) => sum + activityDuration(item), 0);
    const focused = items.filter(item => ["Business", "Work", "Study"].includes(item.category)).reduce((sum, item) => sum + activityDuration(item), 0);
    const sleep = items.filter(item => item.category === "Sleep").reduce((sum, item) => sum + activityDuration(item), 0);
    return {
      total, focused, sleep, activities: items.length, goalLinked: items.filter(item => item.goal_id).length,
      available: Math.max(0, 1440 - total),
    };
  }, [selectedPlan.activities]);
  const blueprint = useMemo(() => getSchedule(blueprintDay), [blueprintDay]);
  const conflictIds = useMemo(() => new Set(selectedPlan.conflicts.flatMap(item => [item.first, item.second])), [selectedPlan.conflicts]);
  const selectedGoal = goals.find(goal => goal.id === form.goalId);

  function openNewActivity(forDate = date) {
    setEditingActivity(null);
    setForm(emptyDraft(forDate));
    setRecurrenceScope("only");
    setFormOpen(true);
    setError("");
  }

  function openEditActivity(activity: Activity) {
    setEditingActivity(activity);
    setForm({
      date: activity.plan_date,
      endDate: typeof activity.data.endDate === "string" ? activity.data.endDate : activity.plan_date,
      title: activity.title,
      description: String(activity.data.description ?? ""),
      startTime: activity.start_time ?? "09:00",
      endTime: activity.end_time ?? "10:00",
      category: activity.category,
      priority: activity.priority,
      goalId: activity.goal_id ?? "",
      milestoneId: activity.milestone_id ?? "",
      location: String(activity.data.location ?? ""),
      notes: String(activity.data.notes ?? ""),
      recurrenceEndDate: typeof activity.data.recurrenceEndDate === "string" ? activity.data.recurrenceEndDate : "",
      status: activity.status,
      actualDuration: activity.actual_duration === null ? "" : String(activity.actual_duration),
    });
    setRecurrenceScope("only");
    setFormOpen(true);
    setError("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingActivity(null);
  }

  async function saveActivity(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const effectiveEndDate = form.endDate === form.date && timeMinutes(form.endTime) <= timeMinutes(form.startTime)
      ? addPlannerDays(form.date, 1) ?? form.endDate
      : form.endDate;
    if (getPlannerDurationMinutes(form.date, form.startTime, effectiveEndDate, form.endTime) === null) {
      setError("An activity must have a positive duration of no more than 24 hours.");
      return;
    }
    const data = { description: form.description, location: form.location, notes: form.notes, endDate: effectiveEndDate };
    const payload = {
      date: form.date,
      title: form.title,
      startTime: form.startTime,
      endTime: form.endTime,
      category: form.category,
      priority: form.priority,
      goalId: form.goalId || null,
      milestoneId: form.milestoneId || null,
      ...(editingActivity ? {
        status: form.status,
        actualStart: editingActivity.actual_start,
        actualEnd: editingActivity.actual_end,
        actualDuration: form.actualDuration === "" ? null : Number(form.actualDuration),
      } : {}),
      data,
      ...(editingActivity && editingActivity.plan_date >= today ? { recurrenceScope } : {}),
    };
    const response = editingActivity
      ? await fetch(`/api/planner/${editingActivity.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json() as { error?: string; conflicts?: Conflict[]; id?: string; recurrenceId?: string | null };
    if (!response.ok) {
      setError(result.error ?? "Activity could not be saved.");
      return;
    }
    const wasNew = !editingActivity;
    const editedRecurrenceId = editingActivity ? recurrenceIdOf(editingActivity) : null;
    const nextRecurrenceId = result.recurrenceId ?? editedRecurrenceId;
    closeForm();
    setDate(form.date);
    setMessage(result.conflicts?.length ? "Saved. The highlighted overlap is intentional only if you want to keep it." : "Activity saved.");
    if (editingActivity && editedRecurrenceId && recurrenceScope !== "only" && nextRecurrenceId) {
      const recurrenceResponse = await fetch("/api/planner/recurrence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurrenceId: nextRecurrenceId, endDate: form.recurrenceEndDate || null }),
      });
      const recurrenceResult = await recurrenceResponse.json() as { error?: string };
      if (!recurrenceResponse.ok) setError(recurrenceResult.error ?? "Activity was saved, but the recurring end date was not updated.");
    }
    await load();
    if (wasNew && result.id) {
      setRepeatActivity({ id: result.id, date: form.date });
      setRepeatMode("single");
      setRepeatEndDate("");
      setCustomDates([]);
      setRepeatConflicts([]);
    }
  }

  async function applyRecurrence(resolution?: "merge" | "replace" | "cancel") {
    if (!repeatActivity || repeatMode === "single") {
      setRepeatActivity(null);
      return;
    }
    const response = await fetch("/api/planner/recurrence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        activityId: repeatActivity.id,
        frequency: repeatMode,
        endDate: repeatEndDate || null,
        customDates,
        ...(resolution ? { resolution } : {}),
      }),
    });
    const result = await response.json() as { error?: string; conflictingDates?: { date: string; activities: string[] }[]; cancelled?: boolean };
    if (response.status === 409 && result.conflictingDates) {
      setRepeatConflicts(result.conflictingDates);
      setError("");
      return;
    }
    if (!response.ok) {
      setError(result.error ?? "The recurring schedule could not be applied.");
      return;
    }
    setRepeatActivity(null);
    setRepeatConflicts([]);
    setMessage(result.cancelled ? "Kept this activity on its selected date only." : "Recurring schedule saved.");
    await load();
  }

  async function resolvePendingRecurrence(resolution: "merge" | "replace" | "skip") {
    if (!pendingRecurrence) return;
    const response = await fetch("/api/planner/recurrence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve", recurrenceId: pendingRecurrence.recurrenceId, date: pendingRecurrence.date, resolution }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "The recurring activity could not be applied.");
      return;
    }
    setPendingRecurrence(null);
    setMessage(resolution === "skip" ? "Skipped this date; other repeats are unchanged." : "Recurring activity applied.");
    await load();
  }

  async function stopRepeating(activity: Activity) {
    const recurrenceId = recurrenceIdOf(activity);
    const fromDate = addPlannerDays(date, 1);
    if (!recurrenceId || !fromDate || !window.confirm("Stop future repeats? Completed activity history will be preserved.")) return;
    const response = await fetch("/api/planner/recurrence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", recurrenceId, fromDate }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "The recurring schedule could not be stopped.");
      return;
    }
    setMessage("Future repeats stopped. Existing execution records were preserved.");
    await load();
  }

  async function changeActivity(activity: Activity, update: Record<string, unknown>) {
    const response = await fetch(`/api/planner/${activity.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Activity update failed.");
      return;
    }
    await load();
  }

  async function deleteActivity(activity: Activity) {
    if (!window.confirm(`Delete “${activity.title}” from ${dateLabel(activity.plan_date)}?`)) return;
    const response = await fetch(`/api/planner/${activity.id}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Activity could not be deleted.");
      return;
    }
    setMessage("Activity deleted for this date.");
    await load();
  }

  async function changeStatus(activity: Activity, status: string) {
    const response = await fetch(`/api/planner/${activity.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Activity status could not be updated.");
      return;
    }
    await load();
  }

  async function changeActualDuration(activity: Activity, value: string) {
    const response = await fetch(`/api/planner/${activity.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actualDuration: value === "" ? null : Number(value) }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Actual duration could not be updated.");
      return;
    }
    await load();
  }

  async function moveActivityToTime(day: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const activity = plans[day]?.activities.find(item => item.id === dragId);
    if (!activity) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const hourHeight = Number(event.currentTarget.dataset.hourHeight ?? 64);
    const minute = Math.max(0, Math.min(1439, Math.round(((event.clientY - bounds.top) / hourHeight) * 4) * 15));
    const duration = Math.max(15, activityDuration(activity));
    const endMinute = minute + duration;
    const nextDate = endMinute >= 1440 ? addPlannerDays(day, 1) ?? day : day;
    const endClock = endMinute >= 1440 ? endMinute - 1440 : endMinute;
    const startTime = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    const endTime = endClock === 1440 ? "24:00" : `${pad(Math.floor(endClock / 60))}:${pad(endClock % 60)}`;
    await changeActivity(activity, { date: day, startTime, endTime, data: { ...activity.data, endDate: nextDate }, ...(recurrenceIdOf(activity) ? { recurrenceScope: "only" } : {}) });
    setDragId("");
  }

  async function saveTemplate() {
    if (!templateTitle.trim()) {
      setError("Enter a template name.");
      return;
    }
    const response = await fetch("/api/planner/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: templateTitle, date }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Template could not be saved.");
      return;
    }
    setTemplateTitle("");
    setMessage("Daily template saved.");
    await load();
  }

  async function applyTemplate() {
    if (!applyTemplateId) return;
    const response = await fetch(`/api/planner/templates/${applyTemplateId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, mode: applyMode }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Template could not be applied.");
      return;
    }
    setMessage("Template applied to this date.");
    await load();
  }

  async function applyBlueprint() {
    const response = await fetch("/api/planner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply-blueprint", date, blueprintDay }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Blueprint could not be applied.");
      return;
    }
    setMessage("Blueprint applied as a dated plan; original routine and past records were left unchanged.");
    await load();
  }

  async function deleteTemplate() {
    if (!applyTemplateId || !window.confirm("Delete this template? Existing dated plans will not change.")) return;
    const response = await fetch(`/api/planner/templates?id=${encodeURIComponent(applyTemplateId)}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Template could not be deleted.");
      return;
    }
    setApplyTemplateId("");
    setMessage("Template deleted.");
    await load();
  }

  function renderActivity(activity: Activity) {
    const repeats = recurrenceIdOf(activity);
    return <article className={`planner-agenda-item ${conflictIds.has(activity.id) ? "has-conflict" : ""}`} key={activity.id}>
      <i className="planner-category-dot" style={{ background: categoryColors[activity.category] ?? categoryColors.Other }} />
      <div className="planner-agenda-time">{formatTime(activity.start_time)}<small>{activity.end_time ? `to ${formatTime(activity.end_time)}` : "No end time"}</small></div>
      <div className="planner-agenda-copy"><span>{activity.category} · {activity.priority}</span><b>{activity.title}</b><small>{activity.goal_id ? `◎ ${goals.find(goal => goal.id === activity.goal_id)?.title ?? "Linked goal"}` : "No linked goal"}{activity.milestone_id ? ` · ${goals.flatMap(goal => goal.milestones ?? []).find(item => item.id === activity.milestone_id)?.title ?? "Milestone"}` : ""}</small>{typeof activity.data.location === "string" && activity.data.location && <small>⌖ {activity.data.location}</small>}{typeof activity.data.description === "string" && activity.data.description && <p>{activity.data.description}</p>}{repeats && <small className="planner-repeats">↻ Recurring schedule</small>}</div>
      <div className="planner-agenda-execution"><select aria-label={`Status for ${activity.title}`} value={activity.status} onChange={event => void changeStatus(activity, event.target.value)}>{statuses.map(status => <option key={status} value={status}>{status}</option>)}
      </select><label>Actual min<input aria-label={`Actual minutes for ${activity.title}`} type="number" min="0" defaultValue={activity.actual_duration === null ? "" : String(activity.actual_duration)} onBlur={event => { if (event.currentTarget.value !== (activity.actual_duration === null ? "" : String(activity.actual_duration))) void changeActualDuration(activity, event.currentTarget.value); }} /></label></div>
      <div className="planner-agenda-actions"><button onClick={() => openEditActivity(activity)}>Edit</button><button onClick={() => void deleteActivity(activity)}>Delete</button>{repeats && <button onClick={() => void stopRepeating(activity)}>Stop repeats</button>}</div>
    </article>;
  }

  function renderTimeline(day: string, items: Activity[], hourHeight: number, compact = false) {
    const dayConflicts = new Set((plans[day]?.conflicts ?? []).flatMap(item => [item.first, item.second]));
    return <div className={`planner-time-grid ${compact ? "compact" : ""}`} style={{ height: `${24 * hourHeight}px` }}>
      {Array.from({ length: 24 }, (_, hour) => <div className="planner-hour-line" key={hour} style={{ top: `${hour * hourHeight}px` }}><span>{formatTime(`${pad(hour)}:00`)}</span><i /></div>)}
      <div className="planner-time-events" data-hour-height={hourHeight} onDragOver={event => event.preventDefault()} onDrop={event => void moveActivityToTime(day, event)}>
        {items.filter(item => item.start_time && item.end_time).map(activity => {
          const start = timeMinutes(activity.start_time);
          const height = Math.max(26, Math.min(1440 - start, activityDuration(activity)) / 60 * hourHeight);
          return <button type="button" className={`planner-event-block ${dayConflicts.has(activity.id) ? "has-conflict" : ""}`} key={activity.id}
            draggable onDragStart={() => setDragId(activity.id)} onClick={() => openEditActivity(activity)}
            style={{ top: `${start / 60 * hourHeight}px`, height: `${height}px`, borderLeftColor: categoryColors[activity.category] ?? categoryColors.Other }}>
            <b>{activity.title}</b><small>{formatTime(activity.start_time)} – {formatTime(activity.end_time)}</small><span>{activity.category}{activity.goal_id ? " · ◎ Goal" : ""}</span>
          </button>;
        })}
      </div>
    </div>;
  }

  if (showBlueprintReports) return <PlanPage onNavigate={onNavigate} onDaySelect={selected => { setDate(selected); setShowBlueprintReports(false); }} />;

  return <LifeFrame active="Plan a Day" onNavigate={onNavigate}>
    <section className="life-content planner-shell">
      <header className="planner-heading">
        <div><p className="eyebrow">INTENTION → TIME → EXECUTION</p><h1>Plan a day</h1><p>One clear calendar for the work ahead.</p></div>
        <button className="life-primary planner-add-button" onClick={() => openNewActivity(date)}>＋ Add activity</button>
      </header>
      {error && <p className="life-error" role="alert">{error}</p>}
      {message && <p className="life-message" role="status">{message}</p>}
      {pendingRecurrence && <section className="planner-conflict-banner" role="alert"><div><b>Recurring activity needs a choice</b><p>{pendingRecurrence.title} falls on {dateLabel(pendingRecurrence.date)}, which already has {pendingRecurrence.existing.map(item => item.title).join(", ")}.</p></div><div><button onClick={() => void resolvePendingRecurrence("merge")}>Merge</button><button onClick={() => void resolvePendingRecurrence("replace")}>Replace planned</button><button onClick={() => void resolvePendingRecurrence("skip")}>Skip date</button></div></section>}

      <section className="planner-calendar">
        <header className="planner-calendar-toolbar">
          <div className="planner-date-controls"><button aria-label="Previous date" disabled={date <= today} onClick={() => setDate(addPlannerDays(date, view === "week" ? -7 : -1) ?? today)}>‹</button><button aria-label="Next date" onClick={() => setDate(addPlannerDays(date, view === "week" ? 7 : view === "agenda" ? 7 : 1) ?? date)}>›</button><strong>{view === "week" ? `${dateLabel(weekDates[0] ?? date)} – ${formatDay(weekDates[weekDates.length - 1] ?? date)}` : dateLabel(date)}</strong><button className="planner-today-button" onClick={() => setDate(today)}>Today</button></div>
          <label className="planner-date-input">Date<input type="date" min={today} value={date} onChange={event => event.target.value && setDate(event.target.value)} /></label>
          <div className="planner-view-switch" role="group" aria-label="Calendar view">{(["day", "week", "agenda"] as PlannerView[]).map(item => <button key={item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item === "day" ? "Day" : item === "week" ? "Week" : "Agenda"}</button>)}</div>
        </header>

        <div className="planner-day-summary">
          <div><small>SCHEDULED</small><b>{hoursLabel(summary.total)}</b></div>
          <div><small>ACTIVITIES</small><b>{summary.activities}</b></div>
          <div><small>FOCUSED WORK</small><b>{hoursLabel(summary.focused)}</b></div>
          <div><small>SLEEP</small><b>{hoursLabel(summary.sleep)}</b></div>
          <div><small>AVAILABLE</small><b>{hoursLabel(summary.available)}</b></div>
          <div><small>GOAL-LINKED</small><b>{summary.goalLinked}</b></div>
        </div>

        {loading && <p className="planner-loading">Loading your calendar…</p>}
        {!loading && view === "day" && <div className="planner-day-view">
          <div className="planner-day-title"><div><p className="eyebrow">{date < today ? "HISTORY" : date === today ? "TODAY" : date === addPlannerDays(today, 1) ? "TOMORROW" : "UPCOMING"}</p><h2>{dateLabel(date)}</h2></div><button className="life-secondary" onClick={() => openNewActivity(date)}>＋ Add to this day</button></div>
          {!selectedPlan.activities.length ? <div className="planner-empty"><b>A clear day is a blank canvas.</b><p>Add an activity or use a saved routine.</p><button className="life-primary" onClick={() => openNewActivity(date)}>Add activity</button></div> : <div className="planner-timeline-layout"><div className="planner-time-labels">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{formatTime(`${pad(hour)}:00`)}</span>)}</div><div className="planner-timeline-scroll">{renderTimeline(date, selectedPlan.activities, 64)}</div></div>}
          {selectedPlan.activities.some(item => !item.start_time || !item.end_time) && <div className="planner-untimed"><h3>Any-time activities</h3>{selectedPlan.activities.filter(item => !item.start_time || !item.end_time).map(renderActivity)}</div>}
        </div>}

        {!loading && view === "week" && <div className="planner-week-scroll"><div className="planner-week-grid">{weekDates.map(day => {
          const plan = plans[day] ?? { activities: [], conflicts: [] };
          const minutes = plan.activities.reduce((sum, activity) => sum + activityDuration(activity), 0);
          return <section className={`planner-week-day ${day === date ? "selected" : ""}`} key={day}>
            <button className="planner-week-date" onClick={() => setDate(day)}><small>{weekdayName(day).slice(0, 3).toUpperCase()}</small><b>{day.slice(-2)}</b><span>{plan.activities.length} · {hoursLabel(minutes)}</span></button>
            <div className="planner-week-canvas">{renderTimeline(day, plan.activities, 38, true)}</div>
            <button className="planner-week-add" onClick={() => openNewActivity(day)}>＋ Add</button>
          </section>;
        })}</div></div>}

        {!loading && view === "agenda" && <div className="planner-agenda">
          {agendaDates.map(day => {
            const plan = plans[day] ?? { activities: [], conflicts: [] };
            const total = plan.activities.reduce((sum, activity) => sum + activityDuration(activity), 0);
            return <section className="planner-agenda-day" key={day}>
              <header><div><p className="eyebrow">{day === today ? "TODAY" : day === addPlannerDays(today, 1) ? "TOMORROW" : weekdayName(day).toUpperCase()}</p><h2>{formatDay(day)} <small>{day.slice(0, 4)}</small></h2></div><span>{plan.activities.length} activities · {hoursLabel(total)}</span><button onClick={() => openNewActivity(day)}>＋</button></header>
              {plan.activities.length ? plan.activities.map(renderActivity) : <p className="planner-agenda-empty">Nothing planned yet. This time is yours.</p>}
            </section>;
          })}
        </div>}
      </section>

      <details className="planner-resources">
        <summary>Reusable plans & original 15-day blueprint</summary>
        <div className="planner-resource-grid">
          <section><h2>15-day routine blueprint</h2><label>Preview day<select value={blueprintDay} onChange={event => setBlueprintDay(event.target.value)}>{getPlanDays().map((day, index) => <option key={day} value={day}>Day {index + 1} · {day}</option>)}</select></label><div className="blueprint-preview">{blueprint.slice(0, 7).map(block => <p key={block.id}><b>{block.start}–{block.end}</b> {block.name}</p>)}{blueprint.length > 7 && <small>+ {blueprint.length - 7} more blocks</small>}</div><button className="life-secondary" onClick={() => void applyBlueprint()}>Apply to selected date</button><button className="planner-link" onClick={() => setShowBlueprintReports(true)}>Open 15-day blueprint history, reports & import/export →</button></section>
          <section><h2>Save / reuse a daily template</h2><div className="planner-resource-row"><input placeholder="Template name" value={templateTitle} onChange={event => setTemplateTitle(event.target.value)} /><button className="life-secondary" onClick={() => void saveTemplate()}>Save this day</button></div><div className="planner-resource-row"><select value={applyTemplateId} onChange={event => setApplyTemplateId(event.target.value)}><option value="">Choose template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}</select><select value={applyMode} onChange={event => setApplyMode(event.target.value)}><option value="merge">Merge into day</option><option value="replace">Replace unexecuted plan</option></select><button className="life-secondary" onClick={() => void applyTemplate()}>Apply</button><button className="life-secondary" disabled={!applyTemplateId} onClick={() => void deleteTemplate()}>Delete</button></div></section>
        </div>
      </details>
    </section>

    {formOpen && <div className="planner-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && closeForm()}><section className="planner-activity-modal" role="dialog" aria-modal="true" aria-labelledby="planner-form-title">
      <header><div><p className="eyebrow">{editingActivity ? "EDIT YOUR PLAN" : "MAKE THE TIME COUNT"}</p><h2 id="planner-form-title">{editingActivity ? "Edit activity" : "Add an activity"}</h2></div><button aria-label="Close" onClick={closeForm}>×</button></header>
      <form onSubmit={event => void saveActivity(event)}>
        <div className="planner-form-grid">
          <label className="planner-form-wide">Activity title<input required maxLength={200} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="What will you focus on?" /></label>
          <label>Start date<input type="date" min={today} required value={form.date} onChange={event => setForm({ ...form, date: event.target.value, endDate: form.endDate === form.date ? event.target.value : form.endDate })} /></label>
          <label>End date<input type="date" min={form.date} value={form.endDate} onChange={event => setForm({ ...form, endDate: event.target.value })} /></label>
          <label>Start time<input type="time" value={form.startTime} onChange={event => setForm({ ...form, startTime: event.target.value })} /></label>
          <label>End time<input type="time" value={form.endTime} onChange={event => setForm({ ...form, endTime: event.target.value })} /></label>
          <div className="planner-duration-presets"><span>Quick duration</span>{[30, 60, 90, 120, 240].map(minutes => <button type="button" key={minutes} onClick={() => {
            const start = timeMinutes(form.startTime);
            const end = start + minutes;
            const dayOffset = Math.floor(end / 1440);
            setForm({ ...form, endTime: `${pad(Math.floor(end % 1440 / 60))}:${pad(end % 60)}`, endDate: addPlannerDays(form.date, dayOffset) ?? form.date });
          }}>{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}</button>)}</div>
          <label>Category<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Priority<select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{["critical", "high", "medium", "low"].map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Related goal<select value={form.goalId} onChange={event => setForm({ ...form, goalId: event.target.value, milestoneId: "" })}><option value="">No linked goal</option>{goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
          <label>Related milestone<select value={form.milestoneId} onChange={event => setForm({ ...form, milestoneId: event.target.value })}><option value="">No linked milestone</option>{(selectedGoal?.milestones ?? []).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Location<input value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} /></label>
          {editingActivity && <><label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label><label>Actual duration (minutes)<input type="number" min="0" value={form.actualDuration} onChange={event => setForm({ ...form, actualDuration: event.target.value })} /></label></>}
          <label className="planner-form-wide">Description<textarea rows={2} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
          <label className="planner-form-wide">Notes<textarea rows={2} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
          {editingActivity && recurrenceIdOf(editingActivity) && editingActivity.plan_date >= today && <>
            <label className="planner-form-wide">Apply edits to<select value={recurrenceScope} onChange={event => setRecurrenceScope(event.target.value)}><option value="only">Only this date</option><option value="following">This and following occurrences</option><option value="all">All future occurrences</option></select></label>
            {recurrenceScope !== "only" && <label className="planner-form-wide">Repeat until (leave blank for ongoing)<input type="date" min={form.date} value={form.recurrenceEndDate} onChange={event => setForm({ ...form, recurrenceEndDate: event.target.value })} /></label>}
          </>}
        </div>
        <footer><button type="button" className="life-secondary" onClick={closeForm}>Cancel</button><button type="submit" className="life-primary">{editingActivity ? "Save changes" : "Save activity"}</button></footer>
      </form>
    </section></div>}

    {repeatActivity && <div className="planner-modal-backdrop"><section className="planner-repeat-modal" role="dialog" aria-modal="true" aria-labelledby="planner-repeat-title">
      <button className="planner-modal-close" aria-label="Close" onClick={() => { setRepeatActivity(null); setRepeatConflicts([]); }}>×</button>
      <p className="eyebrow">{repeatConflicts.length ? "EXISTING PLANS FOUND" : "SCHEDULE SAVED"}</p>
      <h2 id="planner-repeat-title">{repeatConflicts.length ? "How should these dates be handled?" : "How would you like to apply this schedule?"}</h2>
      {!repeatConflicts.length ? <>
        <p>{dateLabel(repeatActivity.date)}</p>
        <fieldset className="planner-repeat-options"><label><input type="radio" name="repeat" checked={repeatMode === "single"} onChange={() => setRepeatMode("single")} /><span><b>ONLY THIS DATE</b><small>Keep this activity on {formatDay(repeatActivity.date)} only.</small></span></label><label><input type="radio" name="repeat" checked={repeatMode === "weekly"} onChange={() => setRepeatMode("weekly")} /><span><b>EVERY {weekdayName(repeatActivity.date).toUpperCase()}</b><small>Repeat on this weekday; other weekdays stay unchanged.</small></span></label><label><input type="radio" name="repeat" checked={repeatMode === "custom"} onChange={() => setRepeatMode("custom")} /><span><b>CUSTOM DATES</b><small>Choose the exact future dates for this activity.</small></span></label></fieldset>
        {repeatMode !== "single" && <label className="planner-repeat-end">Optional recurrence end date<input type="date" min={repeatActivity.date} value={repeatEndDate} onChange={event => setRepeatEndDate(event.target.value)} /></label>}
        {repeatMode === "custom" && <div className="planner-custom-date-picker"><label>Add a date<input type="date" min={addPlannerDays(repeatActivity.date, 1) ?? repeatActivity.date} value={customDateInput} onChange={event => setCustomDateInput(event.target.value)} /></label><button onClick={() => { if (customDateInput && !customDates.includes(customDateInput)) setCustomDates([...customDates, customDateInput].sort()); setCustomDateInput(""); }}>Add date</button><div>{customDates.map(item => <button key={item} onClick={() => setCustomDates(customDates.filter(day => day !== item))}>{dateLabel(item)} ×</button>)}</div></div>}
        <footer><button className="life-secondary" onClick={() => setRepeatActivity(null)}>Not now</button><button className="life-primary" onClick={() => void applyRecurrence()}>{repeatMode === "single" ? "Only this date" : "Save schedule"}</button></footer>
      </> : <>
        <p>These dates already have activities. Choose how to apply the repeat without changing completed history.</p>
        <ul className="planner-conflict-dates">{repeatConflicts.map(item => <li key={item.date}><b>{dateLabel(item.date)}</b><span>{item.activities.join(", ")}</span></li>)}</ul>
        <footer><button className="life-secondary" onClick={() => void applyRecurrence("cancel")}>Cancel repeats</button><button className="life-secondary" onClick={() => void applyRecurrence("merge")}>Merge</button><button className="life-primary" onClick={() => void applyRecurrence("replace")}>Replace planned</button></footer>
      </>}
    </section></div>}

    <div className="planner-drag-live" aria-live="polite">{dragId ? "Drag to a new start time" : ""}</div>
  </LifeFrame>;
}
