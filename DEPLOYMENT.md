# Free deployment: Vercel + Neon

The app uses standard PostgreSQL through `pg`, so it can run on Neon without a Neon-specific client. The app creates its tables and seeds the 15-day schedule on its first database request. It uses one app password, signed HTTP-only sessions, and database-backed login throttling.

## 1. Create a Neon project

1. Sign in at [Neon](https://console.neon.tech) and create a project. Choose a project name and region.
2. Open **Connect**. Select the default branch, database, and role.
3. Turn on **Pooled connection** and copy the connection string. Its hostname should contain `-pooler`; use the full URL, including `sslmode=require` if Neon includes it.
4. Keep this URL private. Do not paste it into GitHub or a `NEXT_PUBLIC_` variable.

Neon documents pooled connection strings for applications that create concurrent connections. ([Neon connection guide](https://neon.com/docs/get-started/connect-neon))

## 2. Import the GitHub repository into Vercel

1. Sign in to [Vercel](https://vercel.com) with GitHub and choose **Add New → Project**.
2. Import `mustafaahmed093/Humun_Efficiency-Tracker`.
3. Keep the framework as **Next.js**, Root Directory as `./`, and the default build settings.
4. Before deploying, add these variables under **Project → Settings → Environment Variables**. Select **Production** for each one.

| Name | Value |
| --- | --- |
| `DATABASE_URL` | The pooled Neon connection string you copied; it should contain `-pooler` in its hostname. |
| `APP_PASSWORD` | A unique password with at least 16 characters. |
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

## Neon Free plan notes

Neon's current Free plan includes 1 GB storage per project and 100 compute-hours per month; its compute can scale to zero after inactivity, so the first database request after idle time may take longer. Plan limits can change. The app also stores up to 14 snapshots in the same Neon database, so use **Export JSON** regularly and keep a copy somewhere separate. ([Neon Free plan details](https://neon.com/blog/neon-free-plan-1-gb-per-project), [Neon scale-to-zero](https://neon.com/docs/manage/endpoints#scale-to-zero))

This setup is intended for one personal account, not multiple users or regulated sensitive data. The login password is shared by this installation. To rotate it, update `APP_PASSWORD` in Vercel and redeploy; rotating `SESSION_SECRET` invalidates existing sessions.
