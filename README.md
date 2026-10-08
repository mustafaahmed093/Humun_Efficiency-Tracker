# Command Center

Command Center is a private, mobile-first tracker for Mustafa’s 15-day plan (7–21 October 2026, Asia/Karachi). It includes the daily schedule, time-locked nightly review, score dashboard, progress graphs, day-by-day plan, reports, Excel/JSON/calendar export, JSON import, development tools, installable PWA shell, offline check-in queue, and database snapshots.

## Run locally

Requirements: Node.js 24 or newer and npm. The app uses a Supabase PostgreSQL database; the old local SQLite database can be exported for one-time import.

1. Copy `.env.example` to `.env.local`, create a Supabase project, and paste its **Transaction pooler** URL into `DATABASE_URL`.
2. Set a unique `APP_PASSWORD` (16+ characters) and random `SESSION_SECRET` (32+ characters).
3. From this folder run:

   ```sh
   npm install
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and enter the password.

The app creates its PostgreSQL tables and seeds the schedule on first use. The Vercel server only needs the Supabase transaction pooler URL. Keep credentials server-side; do not use a public/anon key as `DATABASE_URL`.

## Features

- Aaj schedule with done/missed check-ins, missed reasons, linked prayer check-ins, optimistic updates, and an offline queue that syncs when the device reconnects.
- Review window checked against server time in Karachi. The normal window is 00:30 inclusive to 01:00 exclusive for the previous plan day. The optional late window is 01:00 to 03:00 exclusive.
- Dashboard, six rule-based scores, score trends, goal progress, and nine progress visualizations.
- Fifteen-day overview, JSON/Excel/ICS exports, JSON merge import, and a private report summary that can omit mental-health and safety fields.
- Development-only simulated clock and synthetic demo data. Demo rows are tagged so they can be cleared separately.
- PWA manifest, icon, service worker, and offline fallback page. In a secure origin the browser can install the app. The service worker does not cache authenticated pages or API responses.
- Up to 14 daily JSON snapshots stored in PostgreSQL. They refresh on data writes and when “Save backup now” is used. “Delete all my data” writes a final snapshot before clearing tracker records.

Snapshots share the same Supabase database as tracker data, so they do not protect against loss of that project. Download a JSON export regularly and keep it somewhere private. Supabase Free does not provide downloadable database backups.

## Security and deployment status

This is a single-user app protected by an environment password, signed HTTP-only sessions, persistent login throttling, and PostgreSQL row-level security. It is structured for Vercel + Supabase; you still need to create those accounts, set their environment variables, and complete the first deployment. Push notifications while the app is closed and off-site automated backups are not implemented. See [DEPLOYMENT.md](./DEPLOYMENT.md) for setup and free-tier limitations.

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
npm test         # Schedule, review-window, and scoring unit checks
```

To export an existing local SQLite database into a JSON file for the deployed app, run `npm run migrate:local-data`; then import that file from **15 Din → Import JSON**. The generated file is ignored by Git.
