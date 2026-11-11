"use client";

const links = [
  ["Dashboard", "◫"], ["Aaj", "◷"], ["Review", "☾"], ["Goals", "◎"],
  ["Not To Do", "↘"], ["Plan a Day", "▤"], ["Past Status", "▦"], ["Graphs", "⌁"],
  ["Search", "⌕"], ["Reminders", "◷"],
];

export default function LifeFrame({ active, onNavigate, children }: {
  active: string;
  onNavigate: (tab: string) => void;
  children: React.ReactNode;
}) {
  return <main className="life-app">
    <header className="dash-top">
      <div className="dash-brand">✦ <b>command<span>center</span></b></div>
      <nav>{links.map(([tab, icon]) => <button key={tab} className={tab === active ? "selected" : ""} onClick={() => onNavigate(tab)}><span>{icon}</span>{tab}</button>)}</nav>
      <div className="dash-user"><span className="avatar">M</span><span><b>Mustafa</b><small>KARACHI · PKT</small></span></div>
    </header>
    {children}
  </main>;
}
