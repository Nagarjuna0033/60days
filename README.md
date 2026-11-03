# 60 Day Prep

A small web app for a study group working through **180 LeetCode problems in 60 days** (3 a day).

**Live:** http://129.225.66.124:8080

## Features

- **A new day every morning:** each day unlocks at 6:00 AM IST with three problems (🚶 warm-up, 🏃 core, 🚀 stretch) that get harder over the 60 days. Day 1 is 29 Oct 2026; Days 57–60 are the 🏆 Final Boss.
- **LeetCode auto-tick:** link your LeetCode username and problems you get *Accepted* on LeetCode tick here by themselves. The server checks every 10 minutes, and **↻ Sync** checks right away. Only submissions made after a day unlocks count.
- **Leaderboard and streaks:** total solved, 🔥 day streak and rank. People with equal totals share a rank.
- **Hints, solutions and discussion:** hints stay hidden until you ask. Kotlin solutions (approach, complexity, code, gotcha) are posted the morning after each day. Discussion opens once you've solved a problem, so no spoilers.
- **Next-day preview:** see tomorrow's problem names ahead of time (no hints or solutions).
- **Simple accounts:** sign up with a name and a 4-digit PIN. PINs are bcrypt-hashed, and there's a 15-minute lockout after 5 wrong tries.
- **Light and dark theme:** follows your device until you pick one.

## How it works

```
Browser (public/index.html)
   │  fetch /api/*
   ▼
dev.js — Node HTTP server: serves public/, routes /api/* to api/index.js,
         starts the LeetCode poller (lib/leetcode.js)
   │
   ├── lib/auth.js      name + PIN login, signed session cookie
   ├── lib/db.js        PGlite (embedded Postgres) on the server,
   │                    or any Postgres via DATABASE_URL
   └── lib/leetcode.js  polls LeetCode's public GraphQL API for each
                        linked user's recent accepted submissions
```

- **No build step and no framework.** The front end is one HTML file, and the back end is plain Node 20 using only built-in modules plus three dependencies.
- **Static content lives in the repo:**
  - `public/bank.json` holds the 60 days of problems.
  - `public/solutions.json` holds the solutions. A scheduled job adds yesterday's solutions every morning and pushes them.
- **Data lives in Postgres:** users, ticks, comments and LeetCode links. The schema is created and migrated automatically on start, and only additive changes are made.

## Project structure

| Path | What it is |
|---|---|
| `public/index.html` | The whole front end: login, dashboard, leaderboard, dialogs |
| `public/bank.json` | The 60-day problem bank |
| `public/solutions.json` | Daily solutions, keyed by day |
| `api/index.js` | All API routes |
| `lib/auth.js` | Sign-up/login, PIN hashing, lockout, session cookie |
| `lib/db.js` | Database connection and schema |
| `lib/leetcode.js` | LeetCode lookup, sync and 10-minute poller |
| `dev.js` | HTTP server and static file serving |
| `.github/workflows/deploy.yml` | CI checks and deploy to the server |

## Run locally

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and create an account. With no `DATABASE_URL`, it uses an in-memory database that resets on restart. Set `PGLITE_DIR` to keep data in a folder.

## Configuration

All optional. Set them as environment variables.

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `PGLITE_DIR` | Folder for the embedded database. Leave unset for in-memory |
| `DATABASE_URL` | Use an external Postgres (e.g. Neon) instead of PGlite |
| `SESSION_SECRET` | Key for signing session cookies. If unset, it's derived from `DATABASE_URL` |
| `COOKIE_SECURE` | Set when serving over HTTPS to mark cookies `Secure` |
| `LEETCODE_POLL=off` | Turn off the 10-minute LeetCode poller |
| `ADMIN_NAME`, `ADMIN_PIN` | Create a first admin account when the database is empty |

## Deployment

The app runs on an Oracle Cloud Always Free VM as the `prep60` systemd service, from `/opt/prep60`. Its data is in `/var/lib/prep60/db`.

**Every push to `main` deploys automatically** through GitHub Actions:
1. **Check:** syntax check, JSON validation and a local smoke test.
2. **Deploy:** copy the app to the server over SSH. The database is never touched.
3. **Restart:** `prep60` restarts only if app code changed. Changes to `public/`, docs or the workflow don't restart it.
4. **Health check:** confirm the site responds.

The deploy needs the `DEPLOY_SSH_KEY` repository secret.
