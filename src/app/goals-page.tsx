"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LifeFrame from "@/app/life-frame";

type Milestone = { id: string; title: string; description: string | null; due_date: string | null; target_value: number | null; status: string; position: number; completed_at: string | null; data: { startDate?: string; deliverables?: string[]; relatedTasks?: string[]; notes?: string } };
type GoalAction = { id: string; title: string; description: string; notes: string; priority: string; dueDate: string; estimatedHours: number; completed: boolean };
type GoalCheckin = { id: string; checkin_date: string; worked: number; hours: number; output_value: number | null; target_met: number | null; data: Record<string, unknown> };
type Dependency = { depends_on_goal_id: string; title: string; status: string };
type WeeklyReview = { id: string; week_start: string; data: { wins?: string; blockers?: string; lesson?: string; nextWeek?: string } };
type Goal = {
  id: string; title: string; category: string; priority: string; goal_type: string; status: string;
  start_date: string; target_date: string | null; target_value: number | null; target_unit: string | null;
  current_value: number; is_primary: boolean; data: Record<string, string>; metrics: {
    outcomeProgress: number | null; overachievement: number; executionConsistency: number | null;
    totalHours: number; remainingTarget: number | null; remainingDays: number | null; estimatedCompletionDate: string | null; eligibleCommitments: number; status: string;
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
    { key: "personalImportance", label: "Personal importance (1–10)", type: "number" }, { key: "whyMeaningful", label: "Why is this meaningful to you?", type: "textarea" }, { key: "commitment", label: "My commitment", type: "textarea" },
  ] },
  { title: "Purpose & motivation", fields: [
    { key: "why", label: "Why do I want this?", type: "textarea" }, { key: "lifeChange", label: "What will change after achieving it?", type: "textarea" },
    { key: "benefits", label: "Benefits I expect", type: "textarea" }, { key: "futureBenefit", label: "How will it improve my future?", type: "textarea" },
    { key: "whoBenefits", label: "Who else may benefit?", type: "textarea" }, { key: "ifNotAchieved", label: "What if I do not achieve it?", type: "textarea" },
    { key: "commitmentScale", label: "Commitment (1–10)", type: "number" }, { key: "motivationStatement", label: "Motivation statement", type: "textarea" },
  ] },
  { title: "Target & timeline", fields: [
    { key: "startDate", label: "Start date", type: "date" }, { key: "targetDate", label: "Target completion date / deadline", type: "date" }, { key: "totalDurationDays", label: "Planned duration in days", type: "number" },
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
    { key: "skillsRequired", label: "Skills required", type: "textarea" }, { key: "skillsToDevelop", label: "Skills to develop", type: "textarea" }, { key: "resources", label: "Resources needed", type: "textarea" }, { key: "tools", label: "Tools required", type: "textarea" },
    { key: "budget", label: "Estimated budget", type: "number" }, { key: "people", label: "People involved", type: "textarea" },
    { key: "dependencies", label: "Dependencies / external requirements", type: "textarea" }, { key: "research", label: "Research notes", type: "textarea" }, { key: "methodology", label: "Execution methodology", type: "textarea" },
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
const karachiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const statusNames: Record<string, string> = {
  not_started: "Not started", active: "Active", on_track: "On track", at_risk: "At risk",
  behind_schedule: "Behind schedule", paused: "Paused", completed: "Completed", cancelled: "Cancelled", overdue: "Overdue",
};
function goalOutputPoints(checkins:GoalCheckin[],target:number|null){const rows=checkins.filter(item=>item.output_value!==null).slice().reverse();let running=0;const scale=Math.max(1,target??rows.reduce((sum,item)=>sum+Math.max(0,Number(item.output_value)),0));return rows.map((item,index)=>{running+=Math.max(0,Number(item.output_value));return`${30+index*540/Math.max(1,rows.length-1)},${120-Math.min(100,running/scale*100)}`;}).join(" ");}
function getCompletionReport(data:Record<string,string>){try{return JSON.parse(data.completionReport??"null") as {achievements?:string;challenges?:string;lessons?:string;reflection?:string}|null;}catch{return null;}}

export default function GoalsPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>(emptyDraft);
  const [filter, setFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [expanded, setExpanded] = useState("");
  const [milestoneDraft, setMilestoneDraft] = useState({title:"",description:"",startDate:"",dueDate:"",targetValue:"",deliverables:"",relatedTasks:"",notes:""});
  const [actionTitle, setActionTitle] = useState("");
  const [checkin, setCheckin] = useState({ hours: "1", outputValue: "", targetMet: "", worked: true, note: "", tasks: "", progress: "", difficulties: "", lesson: "", tomorrow: "" });
  const [selectedCheckinDate, setSelectedCheckinDate] = useState(karachiToday);
  const [checkinMonth, setCheckinMonth] = useState(karachiToday().slice(0,7));
  const [weeklyReview, setWeeklyReview] = useState({ wins: "", blockers: "", lesson: "", nextWeek: "" });
  const [dependencyChoice, setDependencyChoice] = useState("");
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [weeklyReviews, setWeeklyReviews] = useState<WeeklyReview[]>([]);
  const [rescueNote, setRescueNote] = useState("");
  const [editingGoal, setEditingGoal] = useState("");
  const [completionGoal, setCompletionGoal] = useState("");
  const [completionDraft, setCompletionDraft] = useState({ achievements: "", challenges: "", lessons: "", reflection: "" });
  const [view, setView] = useState<"grid" | "list" | "timeline">("grid");
  const [checkins, setCheckins] = useState<GoalCheckin[]>([]);

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
        const [dependencyResponse, reviewResponse, checkinResponse] = await Promise.all([
          fetch(`/api/goals/${expanded}/dependencies`, { cache: "no-store" }),
          fetch(`/api/goals/${expanded}/reviews`, { cache: "no-store" }),
          fetch(`/api/goals/${expanded}/checkins`, { cache: "no-store" }),
        ]);
        if (!dependencyResponse.ok || !reviewResponse.ok || !checkinResponse.ok) throw new Error("Goal history could not be loaded.");
        const dependencyPayload = await dependencyResponse.json() as { dependencies: Dependency[] };
        const reviewPayload = await reviewResponse.json() as { reviews: WeeklyReview[] };
        const checkinPayload = await checkinResponse.json() as { checkins: GoalCheckin[] };
        setDependencies(dependencyPayload.dependencies);
        setWeeklyReviews(reviewPayload.reviews);
        setCheckins(checkinPayload.checkins);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Goal history could not be loaded."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  const visibleGoals = useMemo(() => goals.filter(goal => {
    if (categoryFilter !== "all" && goal.category !== categoryFilter) return false;
    if (priorityFilter !== "all" && goal.priority !== priorityFilter) return false;
    if (filter === "all") return true;
    if (filter === "active") return !["paused", "completed", "cancelled", "overdue"].includes(goal.metrics.status);
    if (filter === "at-risk") return ["at_risk", "behind_schedule", "overdue"].includes(goal.metrics.status);
    return goal.metrics.status === filter;
  }), [filter, goals, categoryFilter, priorityFilter]);
  const checkinCalendar = useMemo(() => {
    const [year, month] = checkinMonth.split("-").map(Number);
    const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const leading = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    return { leading, days: Array.from({length:total},(_,index)=>`${checkinMonth}-${String(index+1).padStart(2,"0")}`) };
  }, [checkinMonth]);

  function selectCheckinDate(goal:Goal,date:string) {
    setSelectedCheckinDate(date);setCheckinMonth(date.slice(0,7));
    const record=checkins.find(item=>item.checkin_date===date);
    const data=record?.data??{};
    const tasks=Array.isArray(data.tasks)?data.tasks.map(String).join("\n"):String(data.tasks??"");
    setCheckin({worked:record?Boolean(record.worked):true,hours:record?String(record.hours):"",outputValue:record?.output_value===null||record?.output_value===undefined?"":String(record.output_value),targetMet:record?.target_met===null||record?.target_met===undefined?"":String(Boolean(record.target_met)),note:String(data.note??""),tasks,progress:String(data.progress??data.accomplished??""),difficulties:String(data.difficulties??""),lesson:String(data.lesson??""),tomorrow:String(data.tomorrow??"")});
  }
  function shiftCheckinMonth(delta:number){const [year,month]=checkinMonth.split("-").map(Number);const next=new Date(Date.UTC(year,month-1+delta,1));setCheckinMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,"0")}`);}

  const updateDraft = (key: string, value: string) => setDraft(current => {
    const updated = { ...current, [key]: value };
    localStorage.setItem("cc-goal-draft-v2", JSON.stringify(updated));
    return updated;
  });

  async function createGoal() {
    if (!draft.title?.trim() || !draft.category) { setError("Goal title and category are required."); return; }
    const actionTitles=(draft.actionItems??"").split("\n").map(title=>title.trim()).filter(Boolean);
    let actionItems:GoalAction[];
    if(editingGoal){let previous:GoalAction[]=[];try{previous=JSON.parse(draft.actionItemList??"[]") as GoalAction[]}catch{}actionItems=actionTitles.map((title,index)=>({...previous[index],id:previous[index]?.id??crypto.randomUUID(),title,description:previous[index]?.description??"",notes:previous[index]?.notes??"",priority:previous[index]?.priority??"medium",dueDate:previous[index]?.dueDate??"",estimatedHours:previous[index]?.estimatedHours??0,completed:previous[index]?.completed??false}));}
    else actionItems=actionTitles.map(title=>({id:crypto.randomUUID(),title,description:"",notes:"",priority:"medium",dueDate:"",estimatedHours:0,completed:false}));
    const body={title:draft.title,category:draft.category,priority:draft.priority,goalType:draft.goalType,startDate:draft.startDate||(editingGoal?undefined:null),targetDate:draft.targetDate||null,targetValue:draft.targetValue===""?null:Number(draft.targetValue),targetUnit:draft.targetUnit||null,currentValue:draft.currentValue===""?0:Number(draft.currentValue),data:{...draft,actionItemList:JSON.stringify(actionItems)},...(editingGoal?{deadlineChangeReason:draft.deadlineChangeReason??""}:{isPrimary:goals.length===0})};
    const response = await fetch(editingGoal?`/api/goals/${editingGoal}`:"/api/goals", { method: editingGoal?"PATCH":"POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error ?? "Goal could not be saved."); return; }
    const saved=await response.json() as {id?:string};
    if(!editingGoal){const milestoneIdeas=(draft.milestoneIdeas??"").split("\n").map(line=>line.trim()).filter(Boolean);for(const title of milestoneIdeas){const milestoneResponse=await fetch(`/api/goals/${saved.id}/milestones`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title})});if(!milestoneResponse.ok){setError("Goal saved, but a milestone could not be created. Add it from the goal details.");return;}}}
    else {const existing=goals.find(goal=>goal.id===editingGoal);const desired=(draft.milestoneIdeas??"").split("\n").map(line=>line.trim()).filter(Boolean);const currentTitles=existing?.milestones.map(item=>item.title)??[];const keep=new Set(desired);for(const milestone of existing?.milestones??[]){if(!keep.has(milestone.title)){const deleted=await fetch(`/api/goals/${editingGoal}/milestones?id=${encodeURIComponent(milestone.id)}`,{method:"DELETE"});if(!deleted.ok){setError("Goal saved, but a milestone could not be removed.");return;}}}const unmatched=[...currentTitles];for(const title of desired){const match=unmatched.indexOf(title);if(match>=0)unmatched.splice(match,1);else{const added=await fetch(`/api/goals/${editingGoal}/milestones`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title})});if(!added.ok){setError("Goal saved, but a milestone could not be added.");return;}}}}
    const wasEditing=Boolean(editingGoal);
    setDraft(emptyDraft); localStorage.removeItem("cc-goal-draft-v2");
    setWizardOpen(false); setStep(0);setEditingGoal(""); setMessage(wasEditing?"All goal setup sections saved.":"Goal saved."); await load();
  }

  async function patchGoal(goal: Goal, update: Record<string, unknown>) {
    const response = await fetch(`/api/goals/${goal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) });
    if (!response.ok) { setError("Goal update failed."); return; }
    await load();
  }

  function beginGoalEdit(goal:Goal) { setExpanded(goal.id);setEditingGoal(goal.id);setDraft({...emptyDraft,...goal.data,title:goal.title,category:goal.category,priority:goal.priority,goalType:goal.goal_type,startDate:goal.start_date,targetDate:goal.target_date??"",targetValue:goal.target_value===null?"":String(goal.target_value),targetUnit:goal.target_unit??"",currentValue:String(goal.current_value),actionItemList:goal.data.actionItemList??"[]",actionItems:getActions(goal).map(item=>item.title).join("\n"),milestoneIdeas:goal.milestones.map(item=>item.title).join("\n"),deadlineChangeReason:""});setStep(0);setWizardOpen(true);setError(""); }

  async function saveMilestone(goal: Goal) {
    if (!milestoneDraft.title.trim()) return;
    const response = await fetch(`/api/goals/${goal.id}/milestones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: milestoneDraft.title,description:milestoneDraft.description,startDate:milestoneDraft.startDate||null,dueDate:milestoneDraft.dueDate||null,targetValue:milestoneDraft.targetValue===""?null:Number(milestoneDraft.targetValue),data:{deliverables:milestoneDraft.deliverables.split("\n").filter(Boolean),relatedTasks:milestoneDraft.relatedTasks.split("\n").filter(Boolean),notes:milestoneDraft.notes} }) });
    if (!response.ok) { setError("Milestone could not be saved."); return; }
    setMilestoneDraft({title:"",description:"",startDate:"",dueDate:"",targetValue:"",deliverables:"",relatedTasks:"",notes:""}); await load();
  }
  async function patchMilestone(goal:Goal,milestone:Milestone,update:Record<string,unknown>){const response=await fetch(`/api/goals/${goal.id}/milestones`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:milestone.id,...update})});if(!response.ok){setError("Milestone update failed.");return;}await load();}
  async function moveMilestone(goal:Goal,index:number,delta:-1|1){const other=index+delta;if(other<0||other>=goal.milestones.length)return;const reorder=goal.milestones.map((item,position)=>({id:item.id,position:position===index?other:position===other?index:position}));const response=await fetch(`/api/goals/${goal.id}/milestones`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({reorder})});if(!response.ok){setError("Milestones could not be reordered.");return;}await load();}
  function getActions(goal:Goal):GoalAction[]{try{return JSON.parse(goal.data.actionItemList??"[]") as GoalAction[]}catch{return[];}}
  async function saveActions(goal:Goal,actions:GoalAction[]){await patchGoal(goal,{data:{...goal.data,actionItemList:JSON.stringify(actions)}});}
  async function addAction(goal:Goal){if(!actionTitle.trim())return;await saveActions(goal,[...getActions(goal),{id:crypto.randomUUID(),title:actionTitle.trim(),description:"",notes:"",priority:"medium",dueDate:"",estimatedHours:0,completed:false}]);setActionTitle("");}

  async function saveCheckin(goal: Goal) {
    const response = await fetch(`/api/goals/${goal.id}/checkins`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: selectedCheckinDate, worked: checkin.worked, hours: Number(checkin.hours) || 0,
        outputValue: checkin.outputValue ? Number(checkin.outputValue) : null,
        targetMet: checkin.targetMet === "" ? null : checkin.targetMet === "true",
        data: { note: checkin.note, tasks: checkin.tasks.split("\n").map(value=>value.trim()).filter(Boolean), progress:checkin.progress, difficulties:checkin.difficulties, lesson:checkin.lesson, tomorrow:checkin.tomorrow } }),
    });
    if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error ?? "Daily check-in could not be saved."); return; }
    setMessage(`Goal check-in saved for ${selectedCheckinDate}.`); await load();
    const refreshed=await fetch(`/api/goals/${goal.id}/checkins`,{cache:"no-store"});if(refreshed.ok)setCheckins((await refreshed.json() as {checkins:GoalCheckin[]}).checkins);
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
    setCompletionGoal(goal.id);
    setCompletionDraft({ achievements: "", challenges: "", lessons: "", reflection: "" });
  }
  async function saveCompletionReview() {
    const goal = goals.find(item => item.id === completionGoal);
    if (!goal) return;
    const reviewedAt = new Date().toISOString();
    await patchGoal(goal, { status: "completed", data: { ...goal.data, completionReview: completionDraft.reflection.trim(), completionReport: completionDraft, completedAt: reviewedAt } });
    setCompletionGoal("");
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
      <div className="life-toolbar"><div className="life-filters">{[["all","All"],["active","Active"],["at-risk","At risk"],["paused","Paused"],["completed","Completed"],["overdue","Overdue"]].map(([key,label])=><button key={key} className={filter===key?"selected":""} onClick={()=>setFilter(key)}>{label}</button>)}</div><div className="goal-filter-selects"><select aria-label="Filter goals by category" value={categoryFilter} onChange={event=>setCategoryFilter(event.target.value)}><option value="all">All categories</option>{Array.from(new Set(goals.map(goal=>goal.category))).sort().map(category=><option key={category}>{category}</option>)}</select><select aria-label="Filter goals by priority" value={priorityFilter} onChange={event=>setPriorityFilter(event.target.value)}><option value="all">All priorities</option>{["critical","high","medium","low"].map(priority=><option key={priority} value={priority}>{priority}</option>)}</select></div><div className="goal-view-controls" aria-label="Goal view">{([["grid","Grid"],["list","List"],["timeline","Timeline"]] as const).map(([key,label])=><button key={key} className={view===key?"selected":""} onClick={()=>setView(key)}>{label}</button>)}</div><span>{loading?"Loading…":`${visibleGoals.length} goals`}</span></div>
      {loading ? <p className="life-empty">Loading goals…</p> : visibleGoals.length === 0 ? <div className="life-empty"><b>No goals here yet.</b><p>Create a goal to define its target and first daily action.</p><button className="life-primary" onClick={()=>setWizardOpen(true)}>Create a goal</button></div> :
        <div className={`goal-grid goal-view-${view}`}>{view === "timeline" ? <div className="goal-timeline">{visibleGoals.map(goal=>{const start=Date.parse(`${goal.start_date}T00:00:00Z`);const end=goal.target_date?Date.parse(`${goal.target_date}T00:00:00Z`):start+30*86400000;const span=Math.max(1,end-start);const elapsed=goal.target_date?Math.min(100,Math.max(0,(span-Math.max(0,Number(goal.metrics.remainingDays??0))*86400000)/span*100)):0;return <button className="goal-timeline-row" key={goal.id} onClick={()=>{setView("list");setExpanded(goal.id);}}><span><b>{goal.title}</b><small>{goal.start_date} — {goal.target_date??"No deadline"}</small></span><i><em style={{left:`${elapsed}%`}}/></i><small>{statusNames[goal.metrics.status]??goal.metrics.status}</small></button>;})}</div> : visibleGoals.map(goal=><article className="goal-card" key={goal.id}>
          <div className="goal-card-head"><span className={`goal-status ${goal.metrics.status}`}>{statusNames[goal.metrics.status] ?? goal.metrics.status}</span><button aria-label="Set as primary focus" title="Set as primary focus" onClick={()=>void patchGoal(goal,{isPrimary:true})}>{goal.is_primary?"★":"☆"}</button></div>
          <p className="eyebrow">{goal.category.toUpperCase()} · {goal.priority.toUpperCase()}</p><h2>{goal.title}</h2>
          <p className="goal-target">{goal.target_value !== null ? `${goal.current_value} / ${goal.target_value} ${goal.target_unit ?? ""}` : "Progress tracked through daily actions"}</p>
          {goal.metrics.outcomeProgress !== null&&<><div className="goal-progress"><i style={{width:`${Math.min(100,goal.metrics.outcomeProgress)}%`}}/></div><small>{goal.metrics.outcomeProgress}% outcome progress{goal.metrics.overachievement?` · +${goal.metrics.overachievement}% over target`:""}</small></>}
          <div className="goal-metrics"><span>Execution consistency <b>{goal.metrics.executionConsistency===null?"—":`${goal.metrics.executionConsistency}%`}</b></span><span>Time invested <b>{goal.metrics.totalHours}h</b></span><span>Deadline <b>{goal.target_date??"No deadline"}</b></span></div>
          {goal.is_primary&&<span className="primary-focus-tag">PRIMARY FOCUS</span>}
          <div className="goal-actions"><button onClick={()=>setExpanded(expanded===goal.id?"":goal.id)}>{expanded===goal.id?"Close":"Details & check-in"}</button><button onClick={()=>beginGoalEdit(goal)}>Edit goal</button>{goal.status==="completed"?<button onClick={()=>void patchGoal(goal,{status:"active"})}>Reopen</button>:goal.status==="cancelled"?<button onClick={()=>void patchGoal(goal,{status:"active"})}>Restart</button>:<><button onClick={()=>void patchGoal(goal,{status:goal.status==="paused"?"active":"paused"})}>{goal.status==="paused"?"Resume":"Pause"}</button><button onClick={()=>void completeGoal(goal)}>Complete & review</button></>}<button onClick={()=>{if(window.confirm("Archive this goal? Its history will be preserved."))void fetch(`/api/goals/${goal.id}`,{method:"DELETE"}).then(()=>load());}}>Archive</button></div>
          {expanded===goal.id&&<div className="goal-detail">
            {goal.data.motivationStatement&&<blockquote>{goal.data.motivationStatement}</blockquote>}
            {["at_risk","behind_schedule","overdue"].includes(goal.metrics.status)&&<section className="goal-rescue"><h3>Rescue this goal</h3><div className="goal-rescue-metrics"><span>Original target <b>{goal.target_value??"—"} {goal.target_unit??""}</b></span><span>Current result <b>{goal.current_value}</b></span><span>Remaining <b>{goal.metrics.remainingTarget??"—"}</b></span><span>Days left <b>{goal.metrics.remainingDays??"—"}</b></span><span>Required daily pace <b>{goal.metrics.remainingTarget!==null&&goal.metrics.remainingDays?`${(goal.metrics.remainingTarget/goal.metrics.remainingDays).toFixed(2)} ${goal.target_unit??"/day"}`:"—"}</b></span></div><p>Unfinished milestones: {goal.milestones.filter(item=>item.status!=="completed").map(item=>item.title).join(", ")||"None"}</p>{goal.data.risks&&<p>Main blockers: {goal.data.risks}</p>}{goal.data.recoveryStrategy&&<p>{goal.data.recoveryStrategy}</p>}{goal.data.lastRescueAction&&<small>Last next step: {goal.data.lastRescueAction}</small>}<label>One small action to get moving<textarea rows={2} value={rescueNote} onChange={event=>setRescueNote(event.target.value)} placeholder="Make the next step specific and manageable"/></label><button className="life-secondary" onClick={()=>void saveRescuePlan(goal)}>Save rescue action</button></section>}
            <section className="goal-execution-calendar"><header><div><h3>Daily execution calendar</h3><small>Recorded check-ins are distinct from missing days.</small></div><div className="goal-calendar-controls"><button aria-label="Previous month" onClick={()=>shiftCheckinMonth(-1)}>‹</button><b>{new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${checkinMonth}-01T00:00:00Z`))}</b><button aria-label="Next month" onClick={()=>shiftCheckinMonth(1)}>›</button></div></header><div className="goal-calendar-grid goal-calendar-weekdays">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day=><span key={day}>{day}</span>)}</div><div className="goal-calendar-grid">{Array.from({length:checkinCalendar.leading},(_,index)=><span className="goal-calendar-blank" key={`blank-${index}`}/>)}{checkinCalendar.days.map(date=>{const record=checkins.find(item=>item.checkin_date===date);const tone=!record?"missing":record.target_met===1?"met":record.target_met===0?"not-met":"recorded";return <button key={date} className={`goal-calendar-day ${tone} ${selectedCheckinDate===date?"selected":""}`} onClick={()=>selectCheckinDate(goal,date)} title={record?`${date} · ${record.hours}h${record.output_value===null?"":` · output ${record.output_value}`} · ${record.target_met===null?"target not recorded":record.target_met?"target met":"target not met"}`:`${date} · no check-in`}><b>{Number(date.slice(-2))}</b>{record&&<small>{record.hours}h</small>}</button>;})}</div><div className="goal-calendar-legend"><span><i className="recorded"/>Recorded</span><span><i className="met"/>Target met</span><span><i className="not-met"/>Target missed</span><span><i className="missing"/>No check-in</span></div></section>            <section className="goal-analytics"><h3>Progress history</h3><p>Outcome and hours are shown separately. Only recorded check-ins appear.</p>{checkins.length>0?<><svg viewBox="0 0 600 150" role="img" aria-label="Goal output history" className="goal-history-chart"><line x1="24" y1="125" x2="580" y2="125"/><line x1="24" y1="20" x2="24" y2="125"/>{checkins.filter(item=>item.output_value!==null).length>1&&<polyline points={goalOutputPoints(checkins,goal.target_value)}/>}<text x="28" y="143">{checkins.at(-1)?.checkin_date}</text><text x="510" y="143">{checkins[0]?.checkin_date}</text></svg><div className="goal-analytics-summary"><span>{checkins.length} recorded check-ins</span><span>Actual: {checkins.reduce((sum,item)=>sum+Number(item.hours||0),0).toFixed(1)}h · Ideal: {Number(goal.data.idealDailyHours||0)}h/day</span><span>{goal.metrics.remainingDays===null?"No deadline":`${goal.metrics.remainingDays} days remaining`}</span><span>{goal.metrics.estimatedCompletionDate?`Estimated completion ${goal.metrics.estimatedCompletionDate}`:"More output history needed for estimate"}</span><span>{checkins.filter(item=>item.target_met===1).length}/{checkins.filter(item=>item.target_met!==null).length} daily targets met</span></div><div className="goal-history-list">{checkins.slice(0,8).map(item=><span key={item.id}>{item.checkin_date}<b>{item.hours}h</b><b>{item.output_value===null?"No output":`${item.output_value} ${goal.target_unit??""}`}</b></span>)}</div></>:<p className="life-empty">No recorded goal check-ins yet.</p>}</section>
            {goal.status==="completed"&&<section className="goal-completion-report"><p className="eyebrow">COMPLETION REVIEW</p><h3>{goal.title}</h3><div><span>Original target</span><b>{goal.target_value??"—"} {goal.target_unit??""}</b><span>Recorded result</span><b>{goal.current_value} {goal.target_unit??""}</b><span>Time invested</span><b>{goal.metrics.totalHours}h</b><span>Milestones completed</span><b>{goal.milestones.filter(item=>item.status==="completed").length}/{goal.milestones.length}</b><span>Deadline</span><b>{goal.target_date??"No deadline"}</b></div>{goal.data.completionReview&&<p>{goal.data.completionReview}</p>}{getCompletionReport(goal.data)&&<div className="completion-reflections">{([['Biggest achievements','achievements'],['Main challenges','challenges'],['Lessons learned','lessons'],['Final reflection','reflection']] as const).map(([label,key])=><p key={key}><b>{label}:</b> {getCompletionReport(goal.data)?.[key]||''}</p>)}</div>}</section>}            <section className="goal-action-items"><h3>Action items</h3>{getActions(goal).map((action,index)=><article key={action.id}><label><input aria-label={`Complete ${action.title}`} type="checkbox" checked={action.completed} onChange={event=>void saveActions(goal,getActions(goal).map(item=>item.id===action.id?{...item,completed:event.target.checked}:item))}/><input aria-label="Action title" defaultValue={action.title} onBlur={event=>{const value=event.target.value.trim();if(value&&value!==action.title)void saveActions(goal,getActions(goal).map(item=>item.id===action.id?{...item,title:value}:item));}}/></label><div><select aria-label="Action priority" value={action.priority} onChange={event=>void saveActions(goal,getActions(goal).map(item=>item.id===action.id?{...item,priority:event.target.value}:item))}>{["critical","high","medium","low"].map(value=><option key={value}>{value}</option>)}</select><input aria-label="Action due date" type="date" value={action.dueDate} onChange={event=>void saveActions(goal,getActions(goal).map(item=>item.id===action.id?{...item,dueDate:event.target.value}:item))}/><input aria-label="Estimated action hours" type="number" min="0" step="0.25" value={action.estimatedHours} onChange={event=>void saveActions(goal,getActions(goal).map(item=>item.id===action.id?{...item,estimatedHours:Number(event.target.value)}:item))}/><button aria-label={`Delete ${action.title}`} onClick={()=>void saveActions(goal,getActions(goal).filter(item=>item.id!==action.id))}>×</button></div><input aria-label="Action description" placeholder="Description" defaultValue={action.description} onBlur={event=>{if(event.target.value!==action.description)void saveActions(goal,getActions(goal).map(item=>item.id===action.id?{...item,description:event.target.value}:item));}}/><input aria-label="Action notes" placeholder="Notes" defaultValue={action.notes} onBlur={event=>{if(event.target.value!==action.notes)void saveActions(goal,getActions(goal).map(item=>item.id===action.id?{...item,notes:event.target.value}:item));}}/><small>Action {index+1}</small></article>)}<div className="inline-form"><input aria-label="New goal action" placeholder="Add action item" value={actionTitle} onChange={event=>setActionTitle(event.target.value)} onKeyDown={event=>event.key==="Enter"&&void addAction(goal)}/><button onClick={()=>void addAction(goal)}>Add action</button></div></section>            <h3>Milestones</h3>{goal.milestones.map((milestone,index)=><article className="milestone-editor" key={milestone.id}><div className="milestone-row"><input aria-label={`Complete ${milestone.title}`} type="checkbox" checked={milestone.status==="completed"} onChange={event=>void patchMilestone(goal,milestone,{completed:event.target.checked})}/><input className="milestone-title-input" aria-label="Milestone title" defaultValue={milestone.title} onBlur={event=>{if(event.target.value.trim()&&event.target.value!==milestone.title)void patchMilestone(goal,milestone,{title:event.target.value});}}/><input aria-label="Milestone due date" type="date" value={milestone.due_date??""} onChange={event=>void patchMilestone(goal,milestone,{dueDate:event.target.value||null})}/><button aria-label="Move milestone up" disabled={index===0} onClick={()=>void moveMilestone(goal,index,-1)}>↑</button><button aria-label="Move milestone down" disabled={index===goal.milestones.length-1} onClick={()=>void moveMilestone(goal,index,1)}>↓</button><button aria-label={`Delete ${milestone.title}`} disabled={milestone.status==="completed"} title={milestone.status==="completed"?"Completed milestones are preserved":"Delete this milestone"} onClick={()=>{if(window.confirm(`Delete milestone “${milestone.title}”?`))void fetch(`/api/goals/${goal.id}/milestones?id=${encodeURIComponent(milestone.id)}`,{method:"DELETE"}).then(load);}}></button></div><details className="milestone-extra"><summary>Milestone details · {milestone.target_value??"No target"}</summary><div><label>Description<input aria-label="Milestone description" defaultValue={milestone.description??""} onBlur={event=>{if(event.target.value!==(milestone.description??""))void patchMilestone(goal,milestone,{description:event.target.value});}}/></label><label>Target value<input aria-label="Milestone target value" type="number" min="0" defaultValue={milestone.target_value??""} onBlur={event=>void patchMilestone(goal,milestone,{targetValue:event.target.value===""?null:Number(event.target.value)})}/></label><label>Start date<input type="date" defaultValue={milestone.data.startDate??""} onBlur={event=>void patchMilestone(goal,milestone,{data:{...milestone.data,startDate:event.target.value}})}/></label><label>Deliverables<textarea rows={2} defaultValue={(milestone.data.deliverables??[]).join("\n")} onBlur={event=>void patchMilestone(goal,milestone,{data:{...milestone.data,deliverables:event.target.value.split("\n").filter(Boolean)}})}/></label><label>Related tasks<textarea rows={2} defaultValue={(milestone.data.relatedTasks??[]).join("\n")} onBlur={event=>void patchMilestone(goal,milestone,{data:{...milestone.data,relatedTasks:event.target.value.split("\n").filter(Boolean)}})}/></label><label>Notes<input defaultValue={milestone.data.notes??""} onBlur={event=>void patchMilestone(goal,milestone,{data:{...milestone.data,notes:event.target.value}})}/></label>{milestone.completed_at&&<small>Completed {milestone.completed_at.slice(0,10)}</small>}</div></details></article>)}
            <section className="goal-milestone-create"><h4>Add milestone</h4><label>Title<input value={milestoneDraft.title} onChange={event=>setMilestoneDraft({...milestoneDraft,title:event.target.value})}/></label><label>Description<input value={milestoneDraft.description} onChange={event=>setMilestoneDraft({...milestoneDraft,description:event.target.value})}/></label><label>Start date<input type="date" value={milestoneDraft.startDate??""} onChange={event=>setMilestoneDraft({...milestoneDraft,startDate:event.target.value})}/></label><label>Due date<input type="date" value={milestoneDraft.dueDate} onChange={event=>setMilestoneDraft({...milestoneDraft,dueDate:event.target.value})}/></label><label>Target value<input type="number" min="0" value={milestoneDraft.targetValue} onChange={event=>setMilestoneDraft({...milestoneDraft,targetValue:event.target.value})}/></label><label>Deliverables<textarea rows={2} value={milestoneDraft.deliverables} onChange={event=>setMilestoneDraft({...milestoneDraft,deliverables:event.target.value})}/></label><label>Related tasks<textarea rows={2} value={milestoneDraft.relatedTasks} onChange={event=>setMilestoneDraft({...milestoneDraft,relatedTasks:event.target.value})}/></label><label>Notes<input value={milestoneDraft.notes} onChange={event=>setMilestoneDraft({...milestoneDraft,notes:event.target.value})}/></label><button className="life-secondary" onClick={()=>void saveMilestone(goal)}>Add milestone</button></section>
            <div className="inline-form"><input aria-label="New milestone" placeholder="Add milestone" value={milestoneDraft.title} onChange={event=>setMilestoneDraft({...milestoneDraft,title:event.target.value})} onKeyDown={event=>event.key==="Enter"&&void saveMilestone(goal)}/><button onClick={()=>void saveMilestone(goal)}>Add</button></div>
            <h3>Goal dependencies</h3>{dependencies.map(dependency=><div className="dependency-row" key={dependency.depends_on_goal_id}><span>{dependency.title} · {dependency.status}</span><button aria-label={`Remove dependency ${dependency.title}`} onClick={()=>void removeDependency(goal,dependency)}>Remove</button></div>)}<div className="inline-form"><select aria-label="Goal this depends on" value={dependencyChoice} onChange={event=>setDependencyChoice(event.target.value)}><option value="">Choose a prerequisite goal</option>{goals.filter(item=>item.id!==goal.id&&!dependencies.some(dependency=>dependency.depends_on_goal_id===item.id)).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><button disabled={!dependencyChoice} onClick={()=>void addDependency(goal)}>Add dependency</button></div>
            <section className="goal-daily-checkin"><header><div><h3>Daily accountability</h3><p>Editing {selectedCheckinDate}; past edits keep an audit record.</p></div><label>Date<input type="date" value={selectedCheckinDate} onChange={event=>selectCheckinDate(goal,event.target.value)}/></label></header><div className="goal-checkin"><label><input type="checkbox" checked={checkin.worked} onChange={event=>setCheckin({...checkin,worked:event.target.checked})}/> Worked on goal</label><label>Hours invested<input type="number" min="0" max="24" step="0.25" value={checkin.hours} onChange={event=>setCheckin({...checkin,hours:event.target.value})}/></label><label>Actual output ({goal.target_unit??"units"})<input type="number" min="0" value={checkin.outputValue} onChange={event=>setCheckin({...checkin,outputValue:event.target.value})}/></label><label>Daily target<select value={checkin.targetMet} onChange={event=>setCheckin({...checkin,targetMet:event.target.value})}><option value="">Not recorded</option><option value="true">Met</option><option value="false">Not met</option></select></label><label className="goal-checkin-wide">Tasks completed<textarea rows={2} value={checkin.tasks} onChange={event=>setCheckin({...checkin,tasks:event.target.value})}/></label><label className="goal-checkin-wide">Measurable progress<textarea rows={2} value={checkin.progress} onChange={event=>setCheckin({...checkin,progress:event.target.value})}/></label><label>Difficulties<textarea rows={2} value={checkin.difficulties} onChange={event=>setCheckin({...checkin,difficulties:event.target.value})}/></label><label>Lesson learned<textarea rows={2} value={checkin.lesson} onChange={event=>setCheckin({...checkin,lesson:event.target.value})}/></label><label>Tomorrow&apos;s target<textarea rows={2} value={checkin.tomorrow} onChange={event=>setCheckin({...checkin,tomorrow:event.target.value})}/></label><label>Notes<textarea rows={2} value={checkin.note} onChange={event=>setCheckin({...checkin,note:event.target.value})}/></label><button className="goal-checkin-wide" onClick={()=>void saveCheckin(goal)}>Save {selectedCheckinDate===karachiToday()?"today's":"historical"} check-in</button></div></section>
            <section className="goal-weekly-review"><h3>Weekly review</h3>{weeklyReviews.slice(0,2).map(review=><details key={review.id}><summary>Week of {review.week_start}</summary><p><b>Wins:</b> {review.data.wins||"—"}</p><p><b>Blockers:</b> {review.data.blockers||"—"}</p><p><b>Lesson:</b> {review.data.lesson||"—"}</p><p><b>Next:</b> {review.data.nextWeek||"—"}</p></details>)}<label>What went well?<textarea value={weeklyReview.wins} onChange={event=>setWeeklyReview({...weeklyReview,wins:event.target.value})}/></label><label>What got in the way?<textarea value={weeklyReview.blockers} onChange={event=>setWeeklyReview({...weeklyReview,blockers:event.target.value})}/></label><label>What did I learn?<textarea value={weeklyReview.lesson} onChange={event=>setWeeklyReview({...weeklyReview,lesson:event.target.value})}/></label><label>Next week&apos;s commitment<textarea value={weeklyReview.nextWeek} onChange={event=>setWeeklyReview({...weeklyReview,nextWeek:event.target.value})}/></label><button className="life-secondary" onClick={()=>void saveWeeklyReview(goal)}>Save this week&apos;s review</button></section>
          </div>}
        </article>)}</div>}
      {completionGoal&&<div className="life-modal-backdrop"><section className="life-modal" role="dialog" aria-modal="true" aria-labelledby="goal-completion-title"><div className="life-modal-head"><div><p className="eyebrow">GOAL COMPLETION · REVIEW</p><h2 id="goal-completion-title">Capture what you achieved</h2><p className="muted">Your outcome, time, milestones, and this reflection will be kept with the goal.</p></div><button aria-label="Close" onClick={()=>setCompletionGoal("")}></button></div><div className="wizard-fields"><label>Biggest achievements<textarea rows={3} value={completionDraft.achievements} onChange={event=>setCompletionDraft({...completionDraft,achievements:event.target.value})}/></label><label>Main challenges<textarea rows={3} value={completionDraft.challenges} onChange={event=>setCompletionDraft({...completionDraft,challenges:event.target.value})}/></label><label>Lessons learned<textarea rows={3} value={completionDraft.lessons} onChange={event=>setCompletionDraft({...completionDraft,lessons:event.target.value})}/></label><label>Final reflection<textarea rows={3} value={completionDraft.reflection} onChange={event=>setCompletionDraft({...completionDraft,reflection:event.target.value})}/></label></div><div className="wizard-actions"><button className="life-secondary" onClick={()=>setCompletionGoal("")}>Cancel</button><button className="life-primary" onClick={()=>void saveCompletionReview()}>Complete goal & save review</button></div></section></div>}
      {wizardOpen&&<div className="life-modal-backdrop"><section className="life-modal" role="dialog" aria-modal="true" aria-labelledby="goal-wizard-title"><div className="life-modal-head"><div><p className="eyebrow">{editingGoal?"EDIT GOAL":"GOAL SETUP"} · STEP {step+1} OF {sections.length}</p><h2 id="goal-wizard-title">{sections[step].title}</h2></div><button aria-label="Close" onClick={()=>{setWizardOpen(false);setEditingGoal("");}}></button></div><div className="wizard-progress"><i style={{width:`${(step+1)/sections.length*100}%`}}/></div><div className="wizard-fields">{sections[step].fields.map(field=><label key={field.key}>{field.label}{field.type==="textarea"?<textarea rows={3} value={draft[field.key]??""} onChange={event=>updateDraft(field.key,event.target.value)}/>:field.type==="select"?<select value={draft[field.key]??field.options?.[0]??""} onChange={event=>updateDraft(field.key,event.target.value)}>{field.options?.map(option=><option key={option} value={option}>{option.replaceAll("_"," ")}</option>)}</select>:<input type={field.type??"text"} min={field.type==="number"?"0":undefined} value={draft[field.key]??""} onChange={event=>updateDraft(field.key,event.target.value)} required={field.required}/>}</label>)}</div><div className="wizard-actions"><button onClick={()=>{localStorage.setItem("cc-goal-draft-v2",JSON.stringify(draft));setMessage("Draft saved on this device.");}} className="life-secondary">Save draft</button><span>{step+1} / {sections.length}</span>{step>0&&<button className="life-secondary" onClick={()=>setStep(step-1)}>Back</button>}{step<sections.length-1?<button className="life-primary" onClick={()=>setStep(step+1)}>Next</button>:<button className="life-primary" onClick={()=>void createGoal()}>{editingGoal?"Save all changes":"Create goal"}</button>}</div></section></div>}
    </section>
  </LifeFrame>;
}
