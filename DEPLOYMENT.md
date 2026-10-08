# Free deployment: Vercel + Supabase

The app now uses PostgreSQL for durable hosted storage and works with Vercel's Node.js runtime. It uses one app-wide password, a signed HTTP-only session cookie, database-backed login throttling, and tables with row-level security enabled. Create the provider projects and set the secrets below before deploying.

## 1. Create the Supabase database

Create a Supabase project, then open **Connect** and copy the **Transaction pooler** connection string. The app uses `pg` with short-lived pooled connections, so use the transaction pooler on port `6543`; do not use a direct database URL for Vercel functions. Keep the database password in the URL-encoded form Supabase provides. The app creates its tables and seeds the 15-day schedule on first request.

## 2. Deploy on Vercel

Push this repository to a private GitHub repository and import it into Vercel. Set these Production environment variables in the Vercel project settings:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase Transaction pooler URL, including `?workaround=supabase-pooler.vercel` |
| `APP_PASSWORD` | A unique password with at least 16 characters |
| `SESSION_SECRET` | A random secret with at least 32 characters |

Generate a secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Add the same variables to Preview only if you intend to use Preview deployments. Never put them in Git or expose them as `NEXT_PUBLIC_*` variables. Do not set `DEV_TOOLS=true` in Vercel.

Vercel will build the app with `npm run build` and assign it an HTTPS URL. Open that URL in Safari/Chrome on your phone, sign in, then choose **Add to Home Screen**. The PWA can install, but authenticated pages and API responses are deliberately not cached for offline use; check-ins may queue locally until connectivity returns.

## 3. Move existing local data

Before switching, keep a copy of the current SQLite database and its `data/backups` folder. From the existing project run:

```sh
npm run migrate:local-data
```

This creates the ignored file `data/command-center-migration.json`, excluding synthetic demo rows. After the deployed app is running, sign in and use **15 Din → Import JSON** to load that file. Confirm the imported rows in the app, then keep the migration file in a private backup location.

## Free-tier limits to plan for

- Vercel Hobby is free for personal projects. Usage limits apply, and exceeding a limit can pause the affected feature until the allowance resets.
- Supabase Free currently has a 500 MB database quota and may pause a low-activity project after seven days. Restoring a paused project may take time.
- Supabase Free does not provide downloadable database backups. The app's 14 snapshots are stored in the same database and are not a disaster-recovery backup. Use **Export JSON** regularly and store the file separately.
- The app's login password is shared by this private installation. To rotate it, update `APP_PASSWORD` in Vercel and redeploy; rotating `SESSION_SECRET` invalidates existing sessions.

Check current plan terms before relying on the free limits. This setup is intended for personal use, not multiple accounts or sensitive regulated data.
