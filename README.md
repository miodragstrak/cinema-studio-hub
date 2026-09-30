# #Cinema Studios — Studio Hub

The studio manager's home screen: book jobs, track them from shoot to delivery, and hand off to Dropbox, ClickUp, GHL and Make.

## Run it locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). With no `.env.local`, jobs save in your browser only. That's fine for building UI.

## Put it on GitHub

```bash
git init
git add .
git commit -m "Studio hub v1"
git branch -M main
git remote add origin https://github.com/<your-account>/cinema-studio-hub.git
git push -u origin main
```

Create the empty repo on GitHub first (no README, so the push doesn't conflict). Make it **private**.

## Deploy to Vercel

1. In Vercel, choose **Add New → Project** and import the GitHub repo. It detects Vite automatically.
2. Deploy. Every push to `main` redeploys; every other branch gets a preview URL.

At this point the live site works in "this device only" mode. Before the team uses it, connect Supabase so data is shared and sign-in is required.

## Connect Supabase (shared data + sign-in)

1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/schema.sql`.
3. Authentication → Providers → Email: keep it on. Authentication → Sign In / Providers: **turn off "Allow new users to sign up"** so only invited people get in.
4. Authentication → URL Configuration: set **Site URL** to your Vercel URL and add `http://localhost:5173` to Redirect URLs.
5. Authentication → Users → **Invite user** for each team member.
6. Project Settings → API: copy the Project URL and anon public key into
   - `.env.local` (local), and
   - Vercel → Project → Settings → Environment Variables as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy.

Jobs saved in a browser before Supabase was connected show a "Move them to the shared workspace" button on the Today screen.

## Connect Make.com (optional)

1. In Make, create a scenario that starts with **Webhooks → Custom webhook** and copy its URL.
2. In Vercel, add `MAKE_WEBHOOK_URL` (server-only, no `VITE_` prefix) and redeploy.
3. In a job, open **Make.com payload → Send to Make**.

The relay (`api/make.js`) only accepts requests from signed-in users. To test it locally, use `npx vercel dev` instead of `npm run dev`, since Vite alone doesn't run the `api/` folder.

## Project layout

```
index.html            App shell
src/main.js           Views, job logic, handoff generators, event handling
src/styles.css        Design tokens (light/dark) and layout
src/store/local.js    Browser-only storage
src/store/supabase.js Shared storage, sign-in, live updates
api/make.js           Vercel function: relays jobs to Make
supabase/schema.sql   Tables and access rules
AGENTS.md             Context for Cursor / Claude Code / Copilot
```
