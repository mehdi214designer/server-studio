---
name: server-studio
description: Save a local dev server into the Server Studio app. Use this whenever you scaffold, build, or set up a project that runs a local server (npm run dev, vite, next, php -S, wp-env, Local WP, a static server, etc.), or when the user says "save this server", "add to dashboard", "add to Server Studio", "save to Server Studio", "register the server". Adds the project's name, run command, folder, and URL/port so it shows up in the Server Studio app for one-click run.
---

# Save Server to Dashboard

The user runs **Server Studio**, an app that lists their local servers for one-click run/stop.
This skill adds a server to that dashboard so nothing gets lost.

## When to use it

After you build or set up anything that runs on a local port, register it. Examples:
- You scaffolded a site/app and the dev command is `npm run dev` on `localhost:3000`
- You started a static preview, a Vite/Next/Astro server, `php -S`, `wp-env`, Storybook, etc.
- The user asks to "save the server", "add it to the dashboard", "register this"

If the run command or port isn't obvious yet, figure it out first (check `package.json` scripts,
the framework default port, or what the server printed when it started). Don't guess wildly.

## The golden rule: one permanent port per project

Every project gets ONE fixed, unique port that NEVER changes. A saved entry is only
useful if its port stays correct, so:

1. **Allocate once.** For a new project, let the script pick a free, never-used port with
   `--assign` (or pass a specific `--url`). It guarantees no two projects share a port.
2. **Bake it into the project so the dev server ALWAYS uses that exact port** — never a random
   one. Use the framework's strict-port option so it fails loudly instead of drifting to another port:
   - Vite: `vite.config` → `server: { port: <n>, strictPort: true }` (or `vite --port <n> --strictPort`)
   - Next.js: dev script → `next dev -p <n>`
   - Astro: `astro dev --port <n>`
   - CRA / react-scripts: `PORT=<n> react-scripts start`
   - Plain Node/Express: read `process.env.PORT || <n>` and document the port
   - PHP: `php -S localhost:<n>`
   Put the exact same port in the `--command` and `--url` you register.
3. **Never reassign.** Re-running the skill for the same project keeps its locked port — it only
   updates the other fields. The script enforces this; do not pass `--force` unless the user
   explicitly wants to move a project to a new port.

## How to save it

Run the helper script with whatever fields you know. Only `--name` (or `--url`/`--command`) is required.

For a NEW project, add `--assign` to get a guaranteed-unique port, then read the `PORT <n>`
line it prints and bake that port into the project config (see the golden rule above).

```bash
node "$HOME/.claude/skills/server-studio/register-server.js" \
  --name "Project Name" \
  --project "What it's for" \
  --category "WordPress" \
  --cwd "/absolute/path/to/project" \
  --command "npm run dev -- --port 3001 --strictPort" \
  --url "localhost:3001" \
  --tag "Vite" \
  --note "anything to remember, e.g. login" \
  --assign
```

Field guide:
- `--name` — short label, e.g. "Portfolio Site"
- `--project` — the project/task it belongs to
- `--category` — broad bucket: WordPress, Web app, Storybook, Docs, etc. (used for the filter chips)
- `--cwd` — absolute project folder; the run command executes here
- `--command` — the exact command that starts the server (this is what the Run button runs)
- `--url` — address or bare port (`3000` works, becomes `localhost:3000`)
- `--tag` — small detail: Vite, MAMP, Next, php
- `--note` — optional reminders (credentials, gotchas)

## Behavior

- The script matches an existing project by **folder** (`cwd`) or **name**. If found it **updates**
  that entry but **keeps its locked port**; otherwise it **adds** a new one. Safe to run repeatedly,
  it won't create duplicates and won't move a project's port.
- Ports are unique across all entries. `--assign` picks the lowest free port starting at 3001.
- The script prints `PORT <n>` — use that number when wiring the project's dev config.
- Data is written to the Server Studio data file: `~/Library/Application Support/Server Studio/data.json`
  on macOS, `%APPDATA%\Server Studio\data.json` on Windows, `~/.config/server-studio/data.json` on Linux.
- The dashboard **auto-refreshes** every few seconds, so new/updated entries appear on their own.

## Default behavior for the assistant

When you finish building something that has a local server, save it automatically and tell the user
in one line what you saved. Keep it casual, e.g. "Saved 'X' to your Server Studio, reload the tab to run it."
Only skip saving if there's genuinely no local server involved.
