"use client";

import { useCallback, useEffect, useState } from "react";
import LifeFrame from "@/app/life-frame";

type Reminder = { id: string; kind: string; enabled: boolean; preferred_time: string | null; frequency: string; data: { title: string; weekday?: number | null } };
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const reminderKinds = [["custom","Custom"],["goal_session","Goal work session"],["milestone","Milestone"],["goal_deadline","Goal deadline"],["not_to_do","Private Not To Do check-in"],["schedule","Daily schedule"],["nightly_review","Nightly review"],["weekly_goal_review","Weekly goal review"]];

export default function RemindersPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("20:30");
  const [frequency, setFrequency] = useState("daily");
  const [kind, setKind] = useState("custom");
  const [weekday, setWeekday] = useState(1);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/reminders", { cache: "no-store" });
    if (!response.ok) throw new Error("Reminders could not be loaded.");
    const payload = await response.json() as { reminders: Reminder[] };
    setReminders(payload.reminders);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(cause => setError(cause instanceof Error ? cause.message : "Reminders could not be loaded."));
      if ("Notification" in window) setPermission(Notification.permission);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!("Notification" in window) || Notification.permission !== "granted" || document.visibilityState !== "visible") return;
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date());
      const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
      const timeNow = `${part("hour")}:${part("minute")}`;
      const dateKey = `${part("year")}-${part("month")}-${part("day")}`;
      const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
      for (const reminder of reminders) {
        if (!reminder.enabled || reminder.preferred_time !== timeNow ||
            (reminder.frequency === "weekly" && reminder.data.weekday !== dayIndex)) continue;
        const key = `cc-reminder-fired:${reminder.id}:${dateKey}`;
        if (localStorage.getItem(key)) continue;
        const privateReminder=reminder.kind==="not_to_do";
        new Notification(privateReminder?"Private check-in":reminder.data.title, { body: privateReminder?"Your private Command Center check-in is ready.":"A reminder from your private Command Center." });
        localStorage.setItem(key, "1");
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [reminders]);

  async function createReminder(event: React.FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch("/api/reminders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, time, frequency, weekday, kind }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(payload.error ?? "Reminder could not be saved."); return; }
      setTitle("");
      setMessage("Reminder saved. Browser notifications require permission and this app to remain open.");
      setError("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reminder could not be saved.");
    }
  }

  async function requestPermission() {
    if (!("Notification" in window)) { setError("This browser does not support notifications."); return; }
    const result = await Notification.requestPermission();
    setPermission(result);
    setMessage(result === "granted" ? "Notifications enabled for this browser." : "Notification permission was not granted.");
  }

  async function update(reminder: Reminder, body: { enabled?: boolean; time?: string }) {
    const response = await fetch(`/api/reminders/${reminder.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { setError("Reminder could not be updated."); return; }
    await load();
  }

  async function remove(reminder: Reminder) {
    const response = await fetch(`/api/reminders/${reminder.id}`, { method: "DELETE" });
    if (!response.ok) { setError("Reminder could not be deleted."); return; }
    await load();
  }

  return <LifeFrame active="Reminders" onNavigate={onNavigate}>
    <section className="life-content">
      <header className="life-heading"><div><p className="eyebrow">GENTLE NUDGES · YOUR SCHEDULE</p><h1>Reminders</h1><p>Set personal daily or weekly reminders.</p></div><button className="life-secondary" onClick={() => void requestPermission()}>{permission === "granted" ? "Notifications enabled" : "Enable browser notifications"}</button></header>
      {error && <p className="life-error" role="alert">{error}</p>}{message && <p className="life-message" role="status">{message}</p>}
      <form className="reminder-form" onSubmit={event => void createReminder(event)}>
        <label>Reminder title<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Review my priorities" /></label>
        <label>Reminder type<select value={kind} onChange={event=>setKind(event.target.value)}>{reminderKinds.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Time<input required type="time" value={time} onChange={event => setTime(event.target.value)} /></label>
        <label>Repeat<select value={frequency} onChange={event => setFrequency(event.target.value)}><option value="daily">Every day</option><option value="weekly">Weekly</option></select></label>
        {frequency === "weekly" && <label>Day<select value={weekday} onChange={event => setWeekday(Number(event.target.value))}>{weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>}
        <button className="life-primary">Add reminder</button>
      </form>
      <p className="reminder-limit">Notifications are browser-local and fire only while this app is open in a visible tab. They are not push notifications and do not work after the browser is closed.</p>
      <div className="reminder-list">{reminders.map(reminder => <article key={reminder.id}>
        <div><b>{reminder.data.title}</b><small>{reminderKinds.find(([value])=>value===reminder.kind)?.[1]??"Custom"} · {reminder.preferred_time ?? "No time"} · {reminder.frequency}{reminder.frequency === "weekly" && reminder.data.weekday !== null && reminder.data.weekday !== undefined ? ` · ${weekdays[reminder.data.weekday]}` : ""}</small></div>
        <input aria-label={`Time for ${reminder.data.title}`} type="time" value={reminder.preferred_time ?? "09:00"} onChange={event => void update(reminder, { time: event.target.value })} />
        <button className="life-secondary" onClick={() => void update(reminder, { enabled: !reminder.enabled })}>{reminder.enabled ? "Pause" : "Resume"}</button>
        <button className="reminder-delete" aria-label={`Delete ${reminder.data.title}`} onClick={() => void remove(reminder)}>Delete</button>
      </article>)}</div>
    </section>
  </LifeFrame>;
}
