# Server Studio

A small dashboard for the local dev servers you actually run. Every project gets a card with
its run command, folder and URL, so starting one is a click instead of a hunt through terminal
history. It also keeps one permanent port per project, so a saved entry never goes stale.

Node.js is the only requirement. No npm install inside the app, no Electron, no background daemon.

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

## What's in the box

**The app.** A local dashboard at `127.0.0.1:4587`. Run a server (it opens in a real terminal
window), stop it, open its URL, reveal its folder, and see at a glance which ports are live.

**The Claude Code skill.** Ask Claude to build you something with a dev server and it registers the
server for you, picking a free port and baking it into the project config so the port never drifts.

**The Cowork plugin.** The same skill as a `/server-studio` command. Build it with
`npm run build:plugin`, then open `dist/server-studio.plugin`.

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
