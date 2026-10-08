"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categories, formatDay, getSchedule, planDayForDate, weekdayName, type ScheduleBlock } from "@/lib/schedule";
import DashboardPage from "@/app/dashboard-page";
import ReviewPage from "@/app/review-page";
import GraphsPage from "@/app/graphs-page";
import PlanPage from "@/app/plan-page";

type Log = { id: string; day: string; status: "done" | "missed"; reason: string | null };
const reasons = ["Overthinking", "Neend / Thakan", "Phone / Distraction", "Dusra zaroori kaam", "Family", "Tabiyat", "Lazy feel hua", "Other"];
const prayers = ["Fajr", "Zohr", "Asr", "Maghrib", "Isha"];
const planDays = Array.from({ length: 15 }, (_, i) => new Date(Date.UTC(2026, 9, 7 + i)).toISOString().slice(0, 10));

function pakistanToday() {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  if (local.getHours() < 4) local.setDate(local.getDate() - 1);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

export default function Home() {
  const [day, setDay] = useState(pakistanToday());
  const [logs, setLogs] = useState<Record<string, Log>>({});
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState("Dashboard");
  const [reasonFor, setReasonFor] = useState<ScheduleBlock | null>(null);
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [pinOpen, setPinOpen] = useState(true);
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [clock, setClock] = useState(new Date());
  const lastServerDay = useRef<string | null>(null);
  const [sync, setSync] = useState("Synced");
  const [toast, setToast] = useState("");
  const today = planDayForDate(clock);
  const isFuture = day > today;
  const dayIndex = planDays.indexOf(day) + 1;
  const blocks = useMemo(() => getSchedule(day), [day]);
  const completion = blocks.length ? Math.round(blocks.filter(b => logs[b.id]?.status === "done").length / blocks.length * 100) : 0;

  const loadDay = useCallback(async (which: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/day?date=${which}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load this day");
      const data = await res.json() as { logs: Log[] };
      setLogs(Object.fromEntries(data.logs.map(item => [item.id, item])));
      setOffline(false);
    } catch {
      setOffline(true);
      try {
        const cached = JSON.parse(localStorage.getItem(`logs-${which}`) || "{}");
        setLogs(cached);
      } catch { setLogs({}); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDay(day); }, 0);
    return () => window.clearTimeout(timer);
  }, [day, loadDay]);
  useEffect(() => {
    const online = () => {
      setOffline(false);
      const queued = JSON.parse(localStorage.getItem("cc-queue") || "[]") as { day: string; blockId: string; status: string; reason: string | null }[];
      void (async () => {
        const remaining = [];
        for (const item of queued) {
          try {
            const response = await fetch("/api/day", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
            if (!response.ok) remaining.push(item);
          } catch { remaining.push(item); }
        }
        localStorage.setItem("cc-queue", JSON.stringify(remaining));
        setSync(remaining.length ? "Sync pending" : "Synced");
        void loadDay(day);
      })();
    };
    const offlineFn = () => setOffline(true);
    const timer = window.setInterval(() => setClock(current => new Date(current.getTime() + 30_000)), 30_000);
    window.addEventListener("online", online); window.addEventListener("offline", offlineFn);
    return () => { window.clearInterval(timer); window.removeEventListener("online", online); window.removeEventListener("offline", offlineFn); };
  }, [day, loadDay]);
  useEffect(() => {
    if (!unlocked) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/clock", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { serverNow: string; planDay: string };
        if (!active) return;
        setClock(new Date(payload.serverNow));
        setDay(current => lastServerDay.current === null || current === lastServerDay.current ? payload.planDay : current);
        lastServerDay.current = payload.planDay;
      } catch { setOffline(true); }
    };
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("cc-clock-changed", refresh);
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(interval); window.removeEventListener("cc-clock-changed", refresh); };
  }, [unlocked]);
  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetch("/api/auth/unlock", { method: "PUT" }).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(heartbeat);
  }, []);

  async function saveBlock(block: ScheduleBlock, status: "done" | "missed", why: string | null) {
    const next = { ...logs, [block.id]: { id: block.id, day, status, reason: why } as Log };
    setLogs(next); localStorage.setItem(`logs-${day}`, JSON.stringify(next)); setSync("Syncing…");
    try {
      const response = await fetch("/api/day", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day, blockId: block.id, status, reason: why }) });
      if (!response.ok) throw new Error();
      setSync("Synced");
    } catch {
      setSync("Offline · saved here"); setOffline(true);
      const queued = JSON.parse(localStorage.getItem("cc-queue") || "[]") as unknown[];
      queued.push({ day, blockId: block.id, status, reason: why }); localStorage.setItem("cc-queue", JSON.stringify(queued));
    }
  }

  async function submitReason() {
    if (!reason) return;
    const why = reason === "Other" ? customReason.trim() : reason;
    if (!why) return;
    if (!reasonFor) return;
    await saveBlock(reasonFor, "missed", why);
    setReasonFor(null); setReason(""); setCustomReason("");
  }

  async function unlock() {
    const response = await fetch("/api/auth/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pin }) });
    if (!response.ok) { setPinError(true); return; }
    setUnlocked(true); setPinOpen(false); setPinError(false); void loadDay(day);
    void fetch("/api/backup", { method: "POST" }).catch(() => undefined);
  }

  function currentBlock() {
    const local = new Date(clock.toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
    const minutes = local.getHours() * 60 + local.getMinutes() + (local.getHours() < 4 ? 1440 : 0);
    const found = blocks.find(b => {
      const [sh, sm] = b.start.split(":").map(Number); const [eh, em] = b.end.split(":").map(Number);
      const start = sh * 60 + sm; const end = eh * 60 + em;
      return minutes >= start && minutes < end;
    });
    return found;
  }
  const current = currentBlock();
  const previous = () => setDay(planDays[Math.max(0, planDays.indexOf(day) - 1)]);
  const next = () => setDay(planDays[Math.min(14, planDays.indexOf(day) + 1)]);

  if (!unlocked && pinOpen) return <main className="unlock-screen"><div className="unlock-card"><div className="brand-mark">✦</div><p className="eyebrow">MUSTAFA · PRIVATE SPACE</p><h1>Command<br /><em>Center.</em></h1><p className="muted">Apne aaj ko behtar banane ka ek chhota qadam.</p><label className="pin-label" htmlFor="pin">PASSWORD</label><input id="pin" className="pin-input" type="password" autoComplete="current-password" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === "Enter" && void unlock()} placeholder="Password" autoFocus /><button className="primary-button unlock-button" onClick={() => void unlock()}>Unlock <span>→</span></button>{pinError && <p className="form-error">Password sahi nahi hai. Dobara try karo.</p>}<p className="small muted center">Private account · session expires after 12 hours</p></div></main>;

  if (tab === "Dashboard") return <DashboardPage day={today} onNavigate={setTab} />;
  if (tab === "Review") return <ReviewPage onNavigate={setTab} />;
  if (tab === "Graphs") return <GraphsPage onNavigate={setTab} />;
  if (tab === "15 Din") return <PlanPage onNavigate={setTab} onDaySelect={setDay} />;

  const statusLabel = (block: ScheduleBlock) => logs[block.id]?.status;
  const nav = ["Dashboard", "Aaj", "Review", "Graphs", "15 Din"];
  const timeLabel = (s: string) => s.replace(/^0/, "");

  return <main className="app-shell">
      <aside className="sidebar"><div className="side-brand"><span>✦</span><div>command<span>center</span></div></div><div className="side-caption">YOUR 15-DAY RESET</div><div className="side-progress"><div className="progress-copy"><span>THE PLAN</span><b>{dayIndex > 0 ? `DAY ${dayIndex} / 15` : "15 DAYS"}</b></div><div className="progress-line"><i style={{ width: `${Math.max(0, dayIndex) / 15 * 100}%` }} /></div><div className="progress-dates">07 OCT <span>21 OCT 2026</span></div></div><nav className="side-nav">{nav.map((item, i) => <button key={item} className={`nav-item ${tab === item ? "active" : ""}`} onClick={() => setTab(item)}><span className="nav-icon">{["◫", "◷", "☾", "⌁", "▦"][i]}</span>{item}{tab === item && <i />}</button>)}</nav><div className="side-bottom"><div className="avatar">M</div><div><b>Mustafa</b><small>Karachi, PKT</small></div><button title="Lock" className="lock-button" onClick={() => { void fetch("/api/auth/unlock", { method: "DELETE" }); setUnlocked(false); setPinOpen(true); }}>↗</button></div></aside>
    <section className="main-area">
      {offline && <div className="offline-banner">You’re offline — changes save on this device and will sync when you reconnect.</div>}
      <header className="topbar"><div className="mobile-brand">✦ <b>command<span>center</span></b></div><span className="breadcrumb">YOUR SPACE <b>/</b> {tab.toUpperCase()}</span><div className="top-actions"><span className="sync-indicator"><i />{sync}</span><button className="theme-button" aria-label="Theme">◐</button><div className="avatar small-avatar">M</div></div></header>
      <div className="content-wrap">
        <div className="page-heading"><div><p className="eyebrow">{weekdayName(day).toUpperCase()}, {formatDay(day).toUpperCase()} 2026 <span className="live-pill"><i /> YOUR PLAN IS LIVE</span></p><h1>{tab === "Aaj" ? "Aaj ka din." : tab === "Dashboard" ? "Welcome back, Mustafa." : `${tab}.`}</h1><p className="subheading">Chhoti consistency. Bara farq.</p></div><button className="date-chip" onClick={() => { const idx = planDays.indexOf(day); if (idx >= 0) setDay(planDays[(idx + 1) % 15]); }}>◷ <span>{formatDay(day)}<small>{weekdayName(day)}</small></span><b>⌄</b></button></div>
        <div className="day-switcher"><button onClick={previous} disabled={day === planDays[0]}>‹</button><span><b>{weekdayName(day)}</b> <i>·</i> {formatDay(day)} <span className="day-count">DAY {String(dayIndex).padStart(2, "0")} / 15</span></span><button onClick={next} disabled={day === planDays[14] || isFuture}>›</button><span className="completion-mini"><b>{completion}%</b> DONE</span></div>
        <div className="today-grid"><section className="timeline-panel"><div className="section-title"><div><p className="eyebrow">YOUR RHYTHM</p><h2>Aaj ka schedule</h2></div><span className="sync-text">{loading ? "Loading…" : `${blocks.length} blocks`}</span></div>
          <div className="prayer-strip"><div className="prayer-label"><span>✧</span><div><b>Namaz check-in</b><small>Roz ki paanch namazein</small></div></div>{prayers.map(name => { const linked = blocks.find(b => b.prayer === name); const state = linked ? statusLabel(linked) : undefined; return <button key={name} className={`prayer-chip ${state || ""}`} title={name} onClick={() => linked && !isFuture && (state === "done" ? void saveBlock(linked, "missed", "Not done") : setReasonFor(linked))}><span>{state === "done" ? "✓" : name[0]}</span><small>{name}</small></button>; })}</div>
          <div className="timeline">{blocks.map((block, i) => { const status = statusLabel(block); const isCurrent = block.id === current?.id && day === today; return <article key={block.id} className={`schedule-row ${status || ""} ${isCurrent ? "is-current" : ""} ${!status && !isCurrent ? "pending" : ""}`}>
            <div className="time-col"><b>{timeLabel(block.start)}</b><span>{timeLabel(block.end)}</span></div><div className="timeline-rail"><i style={{ "--category": categories[block.category as keyof typeof categories] } as React.CSSProperties}>{status === "done" ? "✓" : status === "missed" ? "×" : ""}</i>{i < blocks.length - 1 && <span />}</div>
            <div className="block-content"><div className="block-topline"><span className="category-label" style={{ color: categories[block.category as keyof typeof categories], background: `${categories[block.category as keyof typeof categories]}14` }}>{block.category}</span>{isCurrent && <span className="now-label"><i /> ABHI</span>}{!status && !isCurrent && block.start < "04:00" && <span className="soft-pending">PENDING</span>}</div><h3>{block.name}</h3>{status === "missed" && <p className="reason-note">Miss hua · {logs[block.id]?.reason}</p>}{isCurrent && <p className="duration-note">Abhi chal raha hai <span>·</span> khatam {timeLabel(block.end)} pe</p>}</div>
            {!isFuture && <div className="block-actions">{status === "done" ? <button className="state-done selected" title="Mark pending" onClick={() => void saveBlock(block, "done", null)}>✓</button> : <button className="state-done" title="Mark done" onClick={() => void saveBlock(block, "done", null)}>✓</button>}{status === "missed" ? <button className="state-missed selected" title="Change reason" onClick={() => { setReasonFor(block); setReason(logs[block.id]?.reason ?? ""); }}>×</button> : <button className="state-missed" title="Mark not done" onClick={() => { setReasonFor(block); setReason(""); }}>×</button>}</div>}
          </article>; })}</div>
        </section>
        <aside className="right-column"><section className="focus-card"><div className="card-overline"><span><i /> LIVE NOW</span><span className="sun-icon">☼</span></div><p className="eyebrow">ABHI</p><h2>{current?.name ?? "Apna waqt apne liye"}</h2><p className="focus-time">{current ? `${timeLabel(current.start)} — ${timeLabel(current.end)}` : "Routine ke darmiyan ka waqt"}</p><div className="focus-divider" /><div className="next-up"><span>NEXT UP</span><b>{current ? blocks[blocks.indexOf(current) + 1]?.name ?? "Din mukammal" : blocks.find(b => b.start > "" )?.name}</b></div><div className="focus-footer"><span>🌿</span> Bas agla qadam lo.</div></section>
          <section className="completion-card"><div className="section-title compact"><div><p className="eyebrow">TODAY’S MOMENTUM</p><h2>Din ka haal</h2></div><button className="more-button">···</button></div><div className="ring-row"><div className="completion-ring" style={{ "--progress": `${completion * 3.6}deg` } as React.CSSProperties}><div><b>{completion}<small>%</small></b><span>COMPLETE</span></div></div><div className="completion-stats"><div><b>{Object.values(logs).filter(l => l.status === "done").length}</b><span>done</span></div><div><b>{blocks.length - Object.keys(logs).length}</b><span>baqi</span></div><div><b>{Object.values(logs).filter(l => l.status === "missed").length}</b><span>missed</span></div></div></div><p className="encouragement">Har tick, ek waada poora. <span>✦</span></p></section>
          <section className="reminder-card"><span className="reminder-icon">✧</span><div><b>Raat ka Review</b><p>Apna din samajhne ka waqt.<br />Review raat 12:30 pe khulega.</p></div><span className="reminder-arrow">↗</span></section>
        </aside></div>
        <footer className="page-footer"><span>MADE FOR YOUR NEXT CHAPTER</span><span>DAY {String(dayIndex).padStart(2, "0")} OF YOUR RESET <i>✦</i></span></footer>
      </div>
      <nav className="mobile-tabs">{nav.map((item, i) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><span>{["◫", "◷", "☾", "⌁", "▦"][i]}</span>{item}</button>)}</nav>
    </section>
    {reasonFor && <div className="sheet-scrim" onMouseDown={e => e.target === e.currentTarget && setReasonFor(null)}><section className="reason-sheet"><div className="sheet-handle" /><button className="sheet-close" onClick={() => setReasonFor(null)}>×</button><p className="eyebrow">CHECK IN WITH YOURSELF</p><h2>Kya miss hua?</h2><p className="sheet-intro">“{reasonFor.name}” kyun nahi ho saka? Sach bolna hi pehla qadam hai.</p><div className="reason-grid">{reasons.map(item => <button key={item} className={reason === item || (item !== "Other" && reason === item) ? "selected" : ""} onClick={() => setReason(item)}>{reason === item ? <span>✓</span> : null}{item}</button>)}</div>{reason === "Other" && <textarea autoFocus value={customReason} onChange={e => setCustomReason(e.target.value)} placeholder="Apni wajah likho…" rows={3} />}<button className="primary-button save-reason" disabled={!reason || (reason === "Other" && !customReason.trim())} onClick={() => void submitReason()}>Save check-in <span>→</span></button><p className="sheet-privacy">Private hai. Sirf tumhare liye.</p></section></div>}
    {toast && <div className="toast">{toast}<button onClick={() => setToast("")}>×</button></div>}
  </main>;
}
