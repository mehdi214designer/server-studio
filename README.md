# Server Studio

A small dashboard for the local dev servers you actually run.

If you work on more than three or four projects, you know the routine. You want to show someone the
staging build, and first you have to remember which folder it lives in, then whether it starts with
`npm run dev` or `yarn start` or `php -S`, then which port it landed on last time, then why that port
is now busy because something else grabbed it a week ago.

Server Studio gives every project a card holding its folder, its run command and its URL. Click
**Run** and it opens a real terminal window in the right directory with the right command. Click the
URL and the browser opens. The card also shows a live dot for whether that port is currently up, so
you can see what is running without checking.

The other half is the port rule: each project keeps one permanent port that nothing else is allowed
to take. A saved card is worthless if the port drifts, so the app hands out a unique one and you bake
it into the project config. Six months later the card still works.

Node.js is the only requirement. No npm install inside the app, no Electron, no background daemon.

![Server Studio](https://raw.githubusercontent.com/mehdi214designer/server-studio/main/docs/screenshot.png)

## Install

**macOS**

```bash
npx server-studio install
```

That copies the app to `/Applications` and installs the Claude Code skill. Then open it from
Applications, or:

```bash
open -a "Server Studio"
```

**Windows and Linux**

There is no app bundle to install, so run the dashboard directly:

```bash
npx server-studio start
```

It serves the same dashboard at `http://localhost:4587` and opens your browser. Add
`npx server-studio install --no-app` first if you also want the Claude Code skill.

To remove it again:

```bash
npx server-studio uninstall
```

Your saved servers are kept. Add `--purge` if you want those deleted too.

| Option | What it does |
|---|---|
| `--no-app` | Skip the Mac app, install only the skill |
| `--no-skill` | Skip the skill, install only the app |
| `--dry-run` | Print what would happen, change nothing |
| `--purge` | Uninstall only: also delete your saved server list |

## Using it

### Add your first server

Click **Add server**. Only the name matters, everything else can be filled in later.

| Field | What it does | Example |
|---|---|---|
| Name | Card title, and what you search by | `Acme Dashboard` |
| Project | A line of context for future you | `Client analytics UI` |
| Category | Groups cards into filter tabs along the top | `Web app` |
| Project folder | Where the run command executes. **Browse** opens a folder picker | `~/Sites/acme` |
| Run command | Exactly what you would type to start it | `npm run dev` |
| URL / Address | Where it serves. A bare port works and becomes `localhost:PORT` | `5181` |
| Tag | Small label on the card, usually the stack | `Next.js` |
| Notes | Anything you will forget | `Seed data resets on restart` |

### Run, stop, open

Each card has five controls:

| Control | What happens |
|---|---|
| **Run** | Opens a terminal window, `cd`s into the folder, runs the command. Real terminal, so you see the output and can Ctrl-C it |
| Open in browser | Opens the card's URL |
| Stop | Kills whatever process is holding that port. Useful when something is stuck |
| Edit | Change any field |
| Delete | Removes the card. Does not touch the project itself |

The icon inside the URL box copies the address to your clipboard.

The dot next to the URL is live status: green means that port is currently accepting connections,
red means nothing is there. It re-checks every 12 seconds, and **Refresh status** forces it.

Click the star to pin a card to the top. The search box matches name, project, URL, command, tag,
category and notes at once, so searching `wordpress` or `5181` or `vite` all find the right card.

### The one permanent port rule

This is the part that makes saved cards stay useful, and it needs one step from you.

When you add a project, give it a port nothing else uses, then **force the dev server to always use
that exact port**. Most tools will silently pick a different one if the port is busy, which is what
makes a saved entry go stale. Use the strict option so it fails loudly instead:

| Tool | How to pin the port |
|---|---|
| Vite | `server: { port: 5181, strictPort: true }` in `vite.config`, or `vite --port 5181 --strictPort` |
| Next.js | `next dev -p 5181` |
| Astro | `astro dev --port 5181` |
| create-react-app | `PORT=5181 react-scripts start` |
| Express / plain Node | `process.env.PORT || 5181` |
| PHP | `php -S localhost:5181` |

Then put that same port in both the run command and the URL on the card.

### Let Claude do it for you

If you installed the skill, you never have to add cards by hand. Ask Claude Code to build something
with a dev server and it registers the project itself, picks a port no other project is using, and
writes that port into the config with the strict flag set.

You can also just ask:

> save this server to Server Studio

To do it manually, or from a script:

```bash
node ~/.claude/skills/server-studio/register-server.js \
  --name "Acme Dashboard" \
  --cwd "$PWD" \
  --command "npm run dev" \
  --assign
```

`--assign` picks a free port and prints it, so you know what to write into the config. Re-running it
for a project that already exists updates the other fields but keeps the port locked, which is the
whole point.

### Backups

**Export** saves your whole list to `server-studio-backup.json`. **Import** loads one back.

Note that Import **replaces** your entire list rather than merging into it, so export first if you
have anything you care about.

## What's in the box

**The app**, a dashboard served at `127.0.0.1:4587`.

**The Claude Code skill**, so Claude can register servers for you.

**The Cowork plugin**, the same skill as a `/server-studio` command. The installer copies it next to
your data file and prints the path, then you open that file to install it. To rebuild it from source,
run `npm run build:plugin`.

## Platform support

| | macOS | Windows | Linux |
|---|---|---|---|
| Dashboard | yes | yes | yes |
| Installable app | yes | run with `start` | run with `start` |
| Run in a terminal | Terminal | Command Prompt | first of x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm |
| Stop a port | `lsof` + `kill` | `netstat` + `taskkill` | `lsof` + `kill` |
| Browse for a folder | native dialog | native dialog | needs `zenity`, otherwise type the path |

Windows and Linux support is written but has only been exercised on macOS, so treat the first run
on those platforms as unproven. Bug reports welcome.

## Your data

Saved servers live in one file:

| macOS | `~/Library/Application Support/Server Studio/data.json` |
|---|---|
| Windows | `%APPDATA%\Server Studio\data.json` |
| Linux | `~/.config/server-studio/data.json` |

It sits outside the app bundle, so installing, updating and uninstalling never touch it. Point
`SERVER_STUDIO_DATA_DIR` somewhere else to use a different file, which is handy for testing against
a throwaway list.

## Security

The app runs shell commands you saved, so it is deliberately locked to your own machine:

- It binds to `127.0.0.1` only and is never reachable from the network.
- Every write requires `Content-Type: application/json`, which blocks form-based CSRF from any
  site you happen to have open.
- Requests carrying a foreign `Origin` are rejected, and preflights are refused.

Treat the run command on a card the way you would treat a line you are about to paste into your own
terminal, because that is exactly what it becomes.

## Development

```bash
npm run build:plugin   # rebuild dist/server-studio.plugin from skill/
npm test               # install into a temp folder and check the result
```

`skill/` is the single source of truth for the skill. The plugin is built from it, so the two
cannot drift apart.

To run the app against a throwaway server list:

```bash
SERVER_STUDIO_DATA_DIR=/tmp/ss-test node src/server.js
```

`src/` holds the dashboard and the per-OS shims in `platform.js`, and is the only copy of that
code. On macOS the installer copies it into the app bundle, so the bundle never holds a stale
version.

## License

MIT
