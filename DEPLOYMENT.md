# Free deployment: Vercel + Supabase

The app connects directly to Supabase Postgres through `pg`. It creates its tables and seeds the schedule on first use. It uses one app password, signed HTTP-only sessions, and database-backed login throttling. The Supabase project URL and publishable key are not used by this server-side database connection.

## 1. Get the Supabase database connection string

1. Open your Supabase project and click **Connect**.
2. Choose **Transaction pooler** and copy the connection string. It uses port `6543` and a username containing your project reference, such as `postgres.PROJECT_REF`.
3. Replace `[YOUR-PASSWORD]` with the database password you set when creating the project. If you no longer know it, reset it in the Supabase project's database settings.
4. Keep the completed URL private. Do not put it in GitHub or a `NEXT_PUBLIC_` variable.

The transaction pooler is intended for serverless functions. Supabase's connection guide describes this option and its limitations. ([Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres))

## 2. Import the GitHub repository into Vercel

1. Sign in to [Vercel](https://vercel.com) with GitHub and choose **Add New → Project**.
2. Import `mustafaahmed093/Humun_Efficiency-Tracker`.
3. Keep the framework as **Next.js**, Root Directory as `./`, and the default build settings.
4. Before deploying, add these variables under **Project → Settings → Environment Variables**. Select **Production** for each one.

| Name | Value |
| --- | --- |
| `DATABASE_URL` | The Supabase Transaction pooler connection string from step 1. |
| `APP_PASSWORD` | Your 4-digit tracker PIN. |
| `SESSION_SECRET` | Generate a random value with the PowerShell command below. |

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Save the generated secret somewhere private, then paste it as `SESSION_SECRET`. Do not set `DEV_TOOLS=true` in Vercel. Environment-variable changes apply to new deployments, so redeploy after adding or changing them. ([Vercel environment variables](https://vercel.com/docs/environment-variables))

## 3. Deploy and open it on your phone

Click **Deploy**. Vercel should build with `npm run build`. When it finishes, open the Vercel URL and sign in with `APP_PASSWORD`. The first database request creates the app's PostgreSQL tables and plan schedule. If deployment happened before the variables were saved, add them and redeploy.

On your phone, open the HTTPS URL in Safari or Chrome, sign in, and use the browser menu's **Add to Home Screen** option. The app shell can be installed; authenticated pages and API responses are not cached for offline use, though check-ins can queue on the device until it reconnects.

## 4. Import existing local tracker data (optional)

Keep a copy of the local SQLite database and `data/backups` folder first. In PowerShell, from this project directory, run:

```powershell
npm install
npm run migrate:local-data
```

This creates `data/command-center-migration.json`, which is ignored by Git and excludes synthetic demo rows. Once the deployed app is working, sign in and use **15 Din → Import JSON** to import that file. Keep a private copy in case you need to restore the data.

## Supabase Free plan notes

Supabase Free projects may pause after inactivity and have plan-specific database/storage limits. Check the current limits in your Supabase dashboard. The app also stores up to 14 snapshots in the same database, so use **Export JSON** regularly and keep a copy somewhere separate. ([Supabase pricing](https://supabase.com/pricing))

This setup is intended for one personal account, not multiple users or regulated sensitive data. The login password is shared by this installation. To rotate it, update `APP_PASSWORD` in Vercel and redeploy; rotating `SESSION_SECRET` invalidates existing sessions.
