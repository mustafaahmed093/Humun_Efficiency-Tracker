# Command Center

Command Center is a private, mobile-first personal productivity tracker. It preserves Mustafa’s original 15-day plan (9–23 October 2026, Asia/Karachi) and adds persistent goals, private Not To Do tracking, dated day planning, reusable templates, and a Past Status calendar.

## Run locally

Requirements: Node.js 24 or newer and npm. For local development, the app can use the existing SQLite file at `data/command-center.sqlite`. Vercel deployments use PostgreSQL hosted by Supabase.

1. Copy `.env.example` to `.env.local`. Keep `LOCAL_SQLITE_PATH=command-center.sqlite` to use `data/command-center.sqlite`; set `APP_PASSWORD` and `SESSION_SECRET`.
2. To use PostgreSQL locally instead, remove `LOCAL_SQLITE_PATH`, create a Supabase project, and set its **Transaction pooler** connection URL as `DATABASE_URL`.
3. From this folder run:

   ```sh
   npm install
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and enter the password.

The local SQLite database is initialized and seeded on first use. For Vercel, configure `DATABASE_URL` with Supabase’s Transaction pooler URL and leave `LOCAL_SQLITE_PATH` unset. Keep the database URL server-side; never expose it through a `NEXT_PUBLIC_` variable. The project URL and publishable key are not needed for this direct PostgreSQL connection.

## Features

- Aaj schedule with done/missed check-ins, missed reasons, linked prayer check-ins, optimistic updates, and an offline queue that syncs when the device reconnects.
- Goals with a multi-step setup, milestones, primary focus, daily check-ins, progress and execution metrics, deadline tracking, pause/resume, completion, and archive.
- Goal dependency links with cycle prevention, weekly reviews, completion reflections, and next-step rescue actions for goals at risk or behind.
- Private Not To Do rules with daily outcomes, urge and slip reflections, streaks, and history-aware consistency. Missing days are not counted as success.
- Date-specific plans with custom activities, goal links, duration/status tracking, overlap warnings, drag-to-reorder, the original 15-day blueprint, and reusable templates.
- Past Status calendar that distinguishes execution records from unexecuted plans and keeps the original fixed-plan records available.
- Search across goals, milestones, plans, rules, templates, and submitted reflections; daily/weekly reminders with browser-local notifications while the app is open.
- Ongoing nightly reviews for dates outside the original 15-day plan, using dated planner activities and preserving the original plan-specific prayer workflow.
- Version 2 JSON/XLSX exports and merge imports for life-system records. Private Not To Do data is omitted unless sensitive export is explicitly requested; backups include it.
- Review window checked against server time in Karachi. The normal window is 00:30 inclusive to 01:00 exclusive for the previous plan day. The optional late window is 01:00 to 03:00 exclusive.
- Dashboard, six rule-based scores, score trends, goal progress, and nine progress visualizations.
- Fifteen-day overview, JSON/Excel/ICS exports, JSON merge import, and a private report summary that can omit mental-health and safety fields.
- Development-only simulated clock and synthetic demo data. Demo rows are tagged so they can be cleared separately.
- PWA manifest, icon, service worker, and offline fallback page. In a secure origin the browser can install the app. The service worker does not cache authenticated pages or API responses.
- Up to 14 daily JSON snapshots stored in PostgreSQL. They refresh on data writes and when “Save backup now” is used. “Delete all my data” writes a final snapshot before clearing tracker records.

Snapshots share the same database as tracker data, so they do not protect against loss of that database. Download a JSON export regularly and keep it somewhere private. Browser reminders require notification permission and the app to remain open in a visible tab; they are not background push notifications.

## Security and deployment status

This is a single-user app protected by an environment password, signed HTTP-only sessions, and database-backed login throttling. It is structured for Vercel + Supabase; you still need to create those accounts, set their environment variables, and complete the first deployment. Push notifications while the app is closed and off-site automated backups are not implemented. See [DEPLOYMENT.md](./DEPLOYMENT.md) for setup and free-tier limits.

The safety answer is stored as a numeric count and omitted from dashboard responses. Export and report controls require the local unlock. Verify the Umang support number before any release.

## Scoring

Weights and daily pace targets are in [`src/lib/scoring-config.ts`](src/lib/scoring-config.ts); formulas are in [`src/lib/scoring.ts`](src/lib/scoring.ts).

- Religious: prayers 70, nightly lecture 20, Fajr + Surah Yaseen block 10.
- Business: business/startup block completion and capped daily lead pace.
- Health: exercise, 8-hour sleep target, meals, and walk/meditation.
- Mental: mood, stress, and overthinking; blank optional answers use neutral 60.
- Focus: focus rating and completion of startup, lead scrape, and outreach blocks.
- Overall weights: Business 25%, Health 20%, Mental 20%, Focus 20%, Religious 15%.

## Commands

```sh
npm run dev      # Local development server
npm run build    # Production compilation check
npm run start    # Serve a production build (requires the environment variables above)
npm run lint     # ESLint
npm test         # Schedule, review-window, scoring, goal, habit, and planner-metric checks
```

To export an existing local SQLite database into a JSON file for the deployed app, run `npm run migrate:local-data`; then import that file from **15 Din → Import JSON**. The generated file is ignored by Git.
