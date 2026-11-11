"use client";

import { useState } from "react";
import LifeFrame from "@/app/life-frame";

type Result = { kind: string; id: string; title: string; detail: string; date: string | null };

export default function SearchPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (term.trim().length < 2) { setError("Search with at least two characters."); return; }
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(term.trim())}`, { cache: "no-store" });
      const payload = await response.json() as { results?: Result[]; error?: string };
      if (!response.ok) { setError(payload.error ?? "Search could not be completed."); return; }
      setResults(payload.results ?? []);
      setSearched(true);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search could not be completed.");
    }
  }

  return <LifeFrame active="Search" onNavigate={onNavigate}>
    <section className="life-content">
      <header className="life-heading"><div><p className="eyebrow">YOUR PRIVATE DATA</p><h1>Search everything</h1><p>Find goals, milestones, plans, rules, templates, and saved reflections.</p></div></header>
      <form className="global-search-form" onSubmit={event => void search(event)}>
        <input aria-label="Search your data" autoFocus value={term} onChange={event => setTerm(event.target.value)} placeholder="Try a goal, activity, or keyword…" />
        <button className="life-primary">Search</button>
      </form>
      {error && <p className="life-error" role="alert">{error}</p>}
      {searched && !results.length && <div className="life-empty">No matching records found.</div>}
      <div className="search-results">{results.map((result, index) => <article key={`${result.kind}-${result.id}-${index}`}>
        <span>{result.kind}</span><b>{result.title}</b><small>{result.detail}{result.date ? ` · ${result.date}` : ""}</small>
        {result.kind === "Goal" && <button onClick={() => onNavigate("Goals")}>Open goals</button>}
        {result.kind === "Not To Do" && <button onClick={() => onNavigate("Not To Do")}>Open rules</button>}
        {result.kind === "Plan activity" && <button onClick={() => onNavigate("Plan a Day")}>Open planner</button>}
        {result.kind === "Nightly review" && <button onClick={() => onNavigate("Past Status")}>Open history</button>}
      </article>)}</div>
    </section>
  </LifeFrame>;
}
