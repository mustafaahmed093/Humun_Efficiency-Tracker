"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDay, weekdayName } from "@/lib/schedule";
import type { ReviewWindow } from "@/lib/review-time";

type Answers = Record<string, unknown> & { prayers?: Record<string, boolean | null> };
type ReviewBlock = { id: string; start: string; end: string; name: string; category: string; prayer?: string | null; status: "done" | "missed" | null; reason: string | null };
type ReviewResponse = { window: ReviewWindow & { lateEntryEnabled: boolean }; day: string; inPlan: boolean; blocks: ReviewBlock[]; pending: number; review: { answers: Answers; submittedAt: string | null; lateEntry: boolean } | null; summary: { scores: Record<string, number>; completion: number } | null };
type Section = { title: string; subtitle: string; fields?: { key: string; label: string; type: "text" | "textarea" | "number" | "range" | "select" | "yesno"; options?: string[]; min?: number; max?: number; suffix?: string; placeholder?: string }[]; kind?: "prayers" | "activity" | "physical" | "missed" | "safety" };
const prayerNames = ["Fajr", "Zohr", "Asr", "Maghrib", "Isha"];
const scoreNames: Record<string, string> = { business: "Business", health: "Health", mental: "Mental", focus: "Focus", religious: "Religious", overall: "Overall" };
const sections: Section[] = [
  { title: "Aaj ka kaam", subtitle: "Din mein jo hua, usey likhna bhi progress hai.", fields: [
    { key: "dailyWork", label: "Aaj kya kya kiya?", type: "textarea", placeholder: "Aaj ke din ki chhoti bari baatein…" },
    { key: "biggestAchievement", label: "Sab se bari achievement?", type: "text", placeholder: "Koi bhi chhota qadam…" },
    { key: "selfFeedback", label: "Apne aap ko feedback", type: "textarea", placeholder: "Kal ke liye ek baat yaad rakhna…" },
  ] },
  { title: "Namaz", subtitle: "Har namaz ka status check karo. Ye tumhare schedule ke saath sync hota hai.", kind: "prayers" },
  { title: "Business · Outbound", subtitle: "Aaj ke outbound kaam ka snapshot.", fields: [
    { key: "outboundLeads", label: "Leads worked today", type: "number", min: 0 }, { key: "outboundReplies", label: "Replies received", type: "number", min: 0 }, { key: "outboundCalls", label: "Meetings / calls booked", type: "number", min: 0 },
  ] },
  { title: "Medspa agency", subtitle: "Leads se clients tak — sab record karo.", fields: [
    { key: "medspaLeads", label: "Leads worked today", type: "number", min: 0 }, { key: "medspaReplies", label: "Replies", type: "number", min: 0 }, { key: "medspaCalls", label: "Calls booked", type: "number", min: 0 },
    { key: "medspaConverted", label: "Aaj converted", type: "number", min: 0 }, { key: "medspaNotConverted", label: "Convert nahi hue", type: "number", min: 0 },
    { key: "medspaNotConvertedReason", label: "Short reason (optional)", type: "text", placeholder: "Kis wajah se?" }, { key: "medspaClientsTotal", label: "Total clients won (running total)", type: "number", min: 0 },
  ] },
  { title: "LinkedIn", subtitle: "Outreach ke saath inbound growth bhi track karo.", fields: [
    { key: "linkedinSent", label: "Outreach messages sent", type: "number", min: 0 }, { key: "linkedinInbound", label: "Inbound leads / replies", type: "number", min: 0 }, { key: "linkedinPosts", label: "Posts published", type: "number", min: 0 },
  ] },
  { title: "Startup MVP", subtitle: "Har roz ka movement, chahe chhota hi kyun na ho.", fields: [
    { key: "startupProgress", label: "Progress ab kitni hai?", type: "range", min: 0, max: 100, suffix: "%" }, { key: "startupMoved", label: "Aaj kya move hua?", type: "textarea", placeholder: "Feature, research, ya koi decision…" },
  ] },
  { title: "Uni", subtitle: "Classes, effort, aur active rehna.", fields: [
    { key: "classesAttended", label: "Classes attended", type: "number", min: 0 }, { key: "uniEffort", label: "Aaj effort", type: "range", min: 1, max: 10, suffix: "/ 10" }, { key: "uniActivity", label: "Activity / assignment", type: "textarea", placeholder: "Kuch kiya?" },
  ] },
  { title: "Japan car side hustle", subtitle: "Chhota sa check-in.", fields: [
    { key: "japanWorked", label: "Aaj is par kaam hua?", type: "yesno" }, { key: "japanNote", label: "Note", type: "text", placeholder: "Kya hua?" },
  ] },
  { title: "Mental", subtitle: "Apni mental state ko bina judgement ke note karo.", fields: [
    { key: "mood", label: "Mood", type: "select", options: ["Sad", "Guzara", "Productive"] }, { key: "stress", label: "Stress", type: "select", options: ["Nahi", "Thoda", "Zyada"] },
    { key: "stressNote", label: "Stress ke baare mein note", type: "text", placeholder: "Optional" }, { key: "tension", label: "Koi tension?", type: "textarea" }, { key: "happiness", label: "Aaj kis baat se khushi hui?", type: "textarea" },
    { key: "overthinkingCount", label: "Overthinking zone mein kitni baar gaye?", type: "number", min: 0 }, { key: "focusRating", label: "Aaj focus", type: "range", min: 1, max: 10, suffix: "/ 10" },
  ] },
  { title: "Physical", subtitle: "Body ka khayal bhi roz ka kaam hai.", kind: "physical", fields: [
    { key: "mealBreakfast", label: "Nashta", type: "text", placeholder: "Kya khaya?" }, { key: "mealLunch", label: "Lunch", type: "text", placeholder: "Kya khaya?" }, { key: "mealDinner", label: "Dinner / snacks", type: "text", placeholder: "Kya khaya?" },
    { key: "waterGlasses", label: "Paani", type: "number", min: 0, suffix: "glasses" }, { key: "sleepHours", label: "Kal raat neend", type: "number", min: 0, max: 24, suffix: "hours" },
  ] },
  { title: "Family", subtitle: "Qareebi logon ke saath guzra waqt.", fields: [{ key: "familyMinutes", label: "Family ke saath kitne minutes?", type: "number", min: 0, suffix: "minutes" }] },
  { title: "Kya miss hua aur kyun?", subtitle: "Crossed blocks se reasons yahan aa gaye hain. Kuch add karna ho to likho.", kind: "missed" },
  { title: "Ek zaroori check-in", subtitle: "Jawab sirf tumhare liye hai. Iska label dashboard par nahi dikhega.", kind: "safety" },
];

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 3600).toString().padStart(2, "0")}:${Math.floor(total % 3600 / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

export default function ReviewPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const resultRef = useRef<ReviewResponse | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [safetyAlert, setSafetyAlert] = useState(false);
  const [submitted, setSubmitted] = useState<{ scores: Record<string, number>; completion: number; lateEntry?: boolean } | null>(null);
  const load = useCallback(async (initial = false) => {
    try {
      const response = await fetch("/api/review", { cache: "no-store" });
      if (!response.ok) throw new Error("Review status load nahi ho saka.");
      const payload = await response.json() as ReviewResponse;
      setServerOffset(new Date(payload.window.serverNow).getTime() - Date.now());
      const current = resultRef.current;
      if (initial || !current || payload.day !== current.day) {
        resultRef.current = payload;
        setResult(payload);
        if (payload.review?.answers) setAnswers(payload.review.answers);
        else {
          const prayers: Record<string, boolean | null> = Object.fromEntries(prayerNames.map(name => [name, payload.blocks.find(block => block.prayer === name)?.status === "done" ? true : payload.blocks.some(block => block.prayer === name && block.status === "missed") ? false : null]));
          const crossed = payload.blocks.filter(block => block.status === "missed" && block.category !== "Review").map(block => `• ${block.name}: ${block.reason || "wajah nahi likhi"}`).join("\n");
          setAnswers({ prayers, missedReasons: crossed, exerciseDone: payload.blocks.find(block => block.name.toLowerCase().includes("exercise"))?.status === "done", dailyLecture: payload.blocks.find(block => block.name.toLowerCase().includes("dr nauman ali khan lecture"))?.status === "done" });
        }
      } else {
        const next = { ...current, window: payload.window, inPlan: payload.inPlan, day: payload.day };
        resultRef.current = next;
        setResult(next);
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Kuch ghalat ho gaya."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => { void load(true); setNow(Date.now()); }, 0);
    const timer = window.setInterval(() => { setNow(Date.now()); void load(false); }, 10_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    if (!result?.window.open || result.review?.submittedAt || submitted) return;
    const timer = window.setTimeout(async () => {
      try { setSaving(true); await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", day: result.day, answers }) }); }
      catch { setMessage("Draft save nahi hua. Connection check karke dobara try karo."); }
      finally { setSaving(false); }
    }, 750);
    return () => window.clearTimeout(timer);
  }, [answers, result, submitted]);

  const update = (key: string, value: unknown) => setAnswers(old => ({ ...old, [key]: value }));
  const date = result?.day;
  const prayerAnswers = answers.prayers ?? {};
  const blocks = result?.blocks ?? [];
  const prayerPending = blocks.filter(block => block.category !== "Review" && block.status === null && block.prayer && typeof prayerAnswers[block.prayer] === "boolean").length;
  const pendingCount = Math.max(0, (result?.pending ?? 0) - prayerPending);
  const complete = result?.review?.submittedAt || submitted;
  const windowNow = now + serverOffset;
  const serverDate = result ? new Date(result.window.serverNow) : new Date();
  const serverLocal = new Date(serverDate.toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  const minute = serverLocal.getHours() * 60 + serverLocal.getMinutes();
  const openDate = new Date(serverLocal);
  if (minute >= 30) openDate.setDate(openDate.getDate() + 1);
  openDate.setHours(0, 30, 0, 0);
  const serverTarget = result ? new Date(new Date(result.window.serverNow).getTime() + (openDate.getTime() - serverLocal.getTime())) : new Date();
  const remaining = serverTarget.getTime() - windowNow;
  const dayTitle = date ? `${weekdayName(date)}, ${formatDay(date)}` : "Aaj ka Review";

  async function submitReview() {
    if (!result) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", day: result.day, answers }) });
      const payload = await response.json() as { error?: string; pending?: number; scores?: Record<string, number>; completion?: number; lateEntry?: boolean };
      if (!response.ok) { setMessage(payload.error || "Review submit nahi ho saka."); return; }
      setSubmitted({ scores: payload.scores ?? {}, completion: payload.completion ?? 0, lateEntry: payload.lateEntry });
      await load(true);
    } catch { setMessage("Submit ke liye internet connection zaroori hai."); }
    finally { setSaving(false); }
  }

  const nav = ["Dashboard", "Aaj", "Review", "Graphs", "15 Din"];
  if (loading) return <ReviewFrame nav={nav} onNavigate={onNavigate}><div className="review-loading"><i /><span>Server time check ho raha hai…</span></div></ReviewFrame>;
  if (!result?.inPlan) return <ReviewFrame nav={nav} onNavigate={onNavigate}><div className="review-locked"><div className="locked-moon">☾</div><p className="eyebrow">RAAT KA REVIEW</p><h1>Is waqt review<br />available nahi.</h1><p>Plan ke andar koi review date nahi mili.</p><button onClick={() => onNavigate("Dashboard")}>Dashboard par wapas <span>→</span></button></div></ReviewFrame>;
  if (complete) {
    const scores = submitted?.scores ?? result.summary?.scores ?? {};
    const completionPct = submitted?.completion ?? result.summary?.completion ?? 0;
    return <ReviewFrame nav={nav} onNavigate={onNavigate}><div className="review-success"><div className="success-spark">✦</div><p className="eyebrow">DIN KA REFLECTION SAVED</p><h1>Shabash, Mustafa.</h1><p className="review-date">{dayTitle}{result.review?.lateEntry || submitted?.lateEntry ? " · Late entry" : ""}</p><div className="success-summary"><div className="success-completion"><b>{completionPct}%</b><span>schedule complete</span></div>{Object.entries(scoreNames).map(([key, label]) => <div key={key}><span>{label}</span><b>{scores[key] ?? 0}</b></div>)}</div><p className="success-verdict">Aaj ka qadam kal ki bunyaad hai. Apni mehnat par fakhr karo. <span>✦</span></p><button className="review-primary" onClick={() => onNavigate("Dashboard")}>Dashboard dekho <span>→</span></button></div></ReviewFrame>;
  }
  if (!result.window.open) return <ReviewFrame nav={nav} onNavigate={onNavigate}><div className="review-locked"><div className="locked-moon">☾</div><p className="eyebrow">RAAT KA REVIEW <span className="lock-pill">LOCKED</span></p><h1>Din ko samajhne<br />ka waqt aayega.</h1><p>{dayTitle} ka review {result.window.lateEntryEnabled ? "raat 12:30 pe khulega; late entry 3:00 tak." : "raat 12:30 pe khulega."}</p><div className="countdown-box"><small>KHULNE TAK</small><b>{formatCountdown(remaining)}</b><span>Pakistan time · Asia/Karachi</span></div><button onClick={() => void load(true)}>Abhi check karo <span>↻</span></button></div></ReviewFrame>;

  const section = sections[step];
  const exerciseBlock = blocks.find(block => block.name.toLowerCase().includes("exercise"));
  const lectureBlock = blocks.find(block => block.name.toLowerCase().includes("dr nauman ali khan lecture"));
  const missedReasonDefault = blocks.filter(block => block.status === "missed" && block.category !== "Review").map(block => `• ${block.name}: ${block.reason || "wajah nahi likhi"}`).join("\n");
  return <ReviewFrame nav={nav} onNavigate={onNavigate}><div className="review-workspace"><div className="review-topline"><div><p className="eyebrow">RAAT KA REVIEW {result.window.late && <span className="late-pill">LATE ENTRY</span>}</p><h1>Apna din samjho.</h1><p>{dayTitle} · Har jawab optional hai, namaz aur schedule check-in ke ilawa.</p></div><div className="autosave-status"><i />{saving ? "Saving…" : "Draft auto-saved"}</div></div>
    <div className="review-progress-head"><span>SECTION {String(step + 1).padStart(2, "0")} <i>/</i> {String(sections.length).padStart(2, "0")}</span><div><i style={{ width: `${(step + 1) / sections.length * 100}%` }} /></div><span>{Math.round((step + 1) / sections.length * 100)}%</span></div>
    <section className="review-section-card"><div className="review-card-heading"><span className="section-number">{String(step + 1).padStart(2, "0")}</span><div><h2>{section.title}</h2><p>{section.subtitle}</p></div></div>
      {section.kind === "prayers" && <div className="prayer-review-list">{prayerNames.map(name => { const related = blocks.find(block => block.prayer === name); const checked = prayerAnswers[name]; return <div className="prayer-review-row" key={name}><span className="prayer-dot">✧</span><div><b>{name}</b><small>{related ? `${related.start} · linked schedule block` : "Daily prayer check-in"}</small></div><button className={checked === true ? "prayer-choice yes active" : "prayer-choice yes"} onClick={() => update("prayers", { ...prayerAnswers, [name]: true })}>✓ Done</button><button className={checked === false ? "prayer-choice no active" : "prayer-choice no"} onClick={() => update("prayers", { ...prayerAnswers, [name]: false })}>× Not done</button></div>; })}<div className="schedule-pulled"><span>{lectureBlock?.status === "done" ? "✓" : lectureBlock?.status === "missed" ? "×" : "◷"}</span><div><b>Nightly lecture · schedule se linked</b><p>Status: <strong>{lectureBlock?.status === "done" ? "Done" : lectureBlock?.status === "missed" ? "Not done" : "Abhi pending"}</strong></p></div></div><p className="review-required-note">Paanch namazon ka status select karna zaroori hai. Linked namaz entries schedule ke saath update hongi.</p></div>}
      {section.kind === "activity" && <div className="schedule-pulled"><span>◷</span><div><b>Schedule se aaya</b><p>Dr Nauman Ali Khan lecture: <strong>{lectureBlock?.status === "done" ? "Done" : lectureBlock?.status === "missed" ? "Not done" : "Abhi pending"}</strong></p></div></div>}
      {section.fields && <div className={`review-fields ${step === 3 || step === 8 ? "wide-fields" : ""}`}>{section.fields.map(field => {
        const value = answers[field.key];
        return <label className={`review-field ${field.type === "textarea" ? "field-wide" : ""}`} key={field.key}><span>{field.label}</span>{field.type === "textarea" ? <textarea rows={3} value={typeof value === "string" ? value : ""} placeholder={field.placeholder} onChange={e => update(field.key, e.target.value)} /> : field.type === "select" ? <select value={typeof value === "string" ? value : ""} onChange={e => update(field.key, e.target.value || undefined)}><option value="">Select karo…</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select> : field.type === "range" ? <div className="range-control"><input type="range" min={field.min} max={field.max} value={typeof value === "number" ? value : field.min} onChange={e => update(field.key, Number(e.target.value))} /><b>{typeof value === "number" ? value : field.min}<small>{field.suffix}</small></b></div> : field.type === "yesno" ? <div className="yesno-control"><button className={value === true ? "selected" : ""} onClick={() => update(field.key, true)}>Haan</button><button className={value === false ? "selected" : ""} onClick={() => update(field.key, false)}>Nahi</button></div> : <div className="number-control"><input type={field.type} min={field.min} max={field.max} value={typeof value === "number" || typeof value === "string" ? value : ""} placeholder={field.placeholder || "Optional"} onChange={e => update(field.key, field.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)} />{field.suffix && <small>{field.suffix}</small>}</div>}</label>;
      })}</div>}
      {section.kind === "physical" && <div className="schedule-pulled compact-pulled"><span>{exerciseBlock?.status === "done" ? "✓" : exerciseBlock?.status === "missed" ? "×" : "◷"}</span><div><b>Exercise · schedule se linked</b><p>Status: <strong>{exerciseBlock?.status === "done" ? "Done" : exerciseBlock?.status === "missed" ? "Not done" : "Pending — Aaj mein check karo"}</strong></p></div></div>}
      {section.kind === "missed" && <label className="review-field field-wide missed-field"><span>Missed blocks aur wajah</span><textarea rows={Math.max(4, Math.min(9, missedReasonDefault.split("\n").length + 2))} value={typeof answers.missedReasons === "string" ? answers.missedReasons : missedReasonDefault} placeholder="Yahan jo miss hua, uski wajah likho…" onChange={e => update("missedReasons", e.target.value)} /><small>Cross kiye huay blocks ka reason yahan pre-filled hai.</small></label>}
      {section.kind === "safety" && <div className="safety-check"><p>Aaj koi <b>“mar jaun”</b> ya khud ko nuksan wala khayal aaya?</p><div>{["Nahi", "Halka", "Tez"].map(option => <button key={option} className={answers.safetyCheck === option ? "selected" : ""} onClick={() => { update("safetyCheck", option); if (option !== "Nahi") setSafetyAlert(true); }}>{option}</button>)}</div><small>Is jawab ka count private rahega aur dashboard par nahi dikhega.</small></div>}
    </section>
    {message && <div className="review-message">{message}{pendingCount > 0 && <button onClick={() => onNavigate("Aaj")}>Aaj ke baqi blocks check karo</button>}</div>}
    {pendingCount > 0 && <div className="pending-review-note"><span>!</span><div><b>{pendingCount} schedule block{pendingCount === 1 ? "" : "s"} abhi baqi hain</b><small>Review submit karne se pehle Aaj mein har block tick ya cross karo.</small></div><button onClick={() => onNavigate("Aaj")}>Aaj kholo →</button></div>}
    <div className="review-navigation"><button className="review-back" disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>← <span>Peechay</span></button><span>{saving ? "Draft save ho raha hai…" : "Draft automatically save hota hai"}</span>{step < sections.length - 1 ? <button className="review-primary" onClick={() => setStep(s => Math.min(sections.length - 1, s + 1))}>Agla section <span>→</span></button> : <button className="review-primary submit-review" disabled={saving || pendingCount > 0 || prayerNames.some(name => typeof prayerAnswers[name] !== "boolean")} onClick={() => void submitReview()}>Review submit karo <span>✓</span></button>}</div>
  </div>{safetyAlert && <div className="safety-overlay"><div className="safety-modal"><span className="safety-heart">♡</span><p className="eyebrow">TUM AKELAY NAHI HO</p><h2>Kisi apne ko abhi bata do.</h2><p>Baba ya kisi qareebi dost ko abhi bata do. Unke paas jao, unse baat karo, aur abhi akelay mat raho.</p><div className="helpline-box"><small>UMANG HELPLINE</small><b>0311-7786264</b></div><p className="safety-callout">Agar khatra abhi hai, kisi qareebi insaan ke paas jao aur local emergency help lo.</p><button onClick={() => setSafetyAlert(false)}>Main kisi apne ko bataunga <span>→</span></button><small className="verify-number">Helpline number must be verified before public launch.</small></div></div>}</ReviewFrame>;
}

function ReviewFrame({ children, nav, onNavigate }: { children: React.ReactNode; nav: string[]; onNavigate: (tab: string) => void }) {
  return <main className="review-app"><header className="dash-top"><div className="dash-brand">✦ <b>command<span>center</span></b></div><nav>{nav.map((tab, i) => <button key={tab} className={tab === "Review" ? "selected" : ""} onClick={() => onNavigate(tab)}><span>{["◫", "◷", "☾", "⌁", "▦"][i]}</span>{tab}</button>)}</nav><div className="dash-user"><span className="avatar">M</span><span><b>Mustafa</b><small>KARACHI · PKT</small></span></div></header><div className="review-body">{children}</div></main>;
}
