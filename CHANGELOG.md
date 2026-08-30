# Changelog

Notable changes to Server Studio. Dates are release dates.

## 1.2.2 — 2026-08-30

- The version badge no longer keeps offering an update you have already installed. Once you start
  one it reads **restart to finish**, because the running process keeps the old code until it is
  reopened. It returns to a plain version once you restart.

## 1.2.1 — 2026-08-30

- **Fixed:** an installed app reported its version as `0.0.0`, because the code looks for
  `package.json` one level up and the app bundle does not contain one. The badge showed `v0.0.0`,
  the update prompt appeared permanently even straight after updating, and telemetry recorded every
  install as version 0.0.0. The installer now stamps the version beside the code.
- **Fixed:** if the local server was not responding, clicking **Update**, **Run** or **Stop** did
  nothing at all. The failed request threw and was never caught, so there was no error either. Those
  actions now say what went wrong.

## 1.2.0 — 2026-08-30

### Folders replace categories
- The sidebar lists your folders. Click one to filter, click **All servers** to go back.
- Create, rename and delete folders. Deleting one never deletes servers, they move to **Unfiled**.
- Move a server with the folder button on its card, by dragging the card onto a folder, or from
  the Folder field in Edit.
- Existing categories become folders automatically on first launch. Nothing is lost.
- `server-studio add --folder "Name"` files a server as it registers, creating the folder if new.
  `--category` still works as an alias.

### Ports
- Two cards on one port now show a `port clash · fix` badge. Clicking it moves one to a free port.
- Where the dev script is one it recognises, it also writes the new port into that project's
  `package.json`, showing the exact before and after first and keeping a backup. Anything it cannot
  parse safely is refused rather than guessed at.
- Saving a server on a port another card already uses offers a free one instead.
- **Fixed:** `portOf()` only matched a port written after a colon, so a card saved as a bare `5173`
  reported no port at all. That silently skipped both clash detection and the collision check.

### Cards
- Run and Stop are one button that follows the live status: green **Run**, red **Stop** once the
  port answers, and a muted **Working** while it is being rechecked.
- **Fixed:** running a server with no project folder set executed the command in your home
  directory, failing with something confusing like `Missing script: "dev"`. It now refuses, says so
  on the card, and opens the folder field.

### Sidebar
- The version sits under the app name. When a newer release exists it turns green and becomes a
  one-click update.
- A request box: send a message and an email address, both optional to use and easy to dismiss.
  Dismissing it collapses it to a **Request a feature** button.
- A creator credit pinned to the bottom.

### Interface
- Dialogs are in-app and match the rest of the UI, instead of the browser's own
  "localhost:4587 says" boxes. Escape, click-outside and Enter all work, and destructive actions
  get a red button.
- Layout verified from 320px to 1920px with no horizontal overflow. On phones the sidebar
  dissolves and reorders so your servers come before the request box.

### Telemetry and signups
- **Fixed:** an unreachable analytics endpoint added roughly 1.5 seconds to every install because
  the ping held the process open. It no longer does.
- **Fixed:** on Node 18 the request was unref'd before a socket existed, which does not propagate on
  that version, so the delay persisted there. The socket is unref'd too.
- Documented in the README, with `SERVER_STUDIO_NO_TELEMETRY=1` and `DO_NOT_TRACK` both honoured.
- Signups go to the author's own list, so the bundled Cloudflare Worker keeps only anonymous counts
  and its open write route is gone.

## 1.1.1 — 2026-08-25

- Documentation only. Stated precisely what CI checks about the folder picker and what it cannot.
- No runtime change; the file list is identical to 1.1.0.

## 1.1.0 — 2026-08-25

- `npm install -g server-studio` now completes setup on its own. Installing as a project dependency
  or under CI still touches nothing outside the package, and a failure prints a hint rather than
  failing the install.
- Added `server-studio add`, which registers a server with no AI involved, so any editor, agent or
  script can use it. The Claude Code skill wraps this command.

## 1.0.1 — 2026-08-25

- Made clear that installing the package is not the whole setup.
- **Fixed:** the path printed for the Cowork plugin pointed inside `node_modules`, which npx deletes
  as soon as it finishes. The plugin is copied somewhere durable first.

## 1.0.0 — 2026-08-20

First public release.

- A local dashboard for your dev servers: run, stop, open, and live port status.
- One permanent port per project, with the rule documented per framework.
- Ships a Claude Code skill and a Cowork plugin.
- **Fixed before release:** the local server accepted cross-site form posts, so any page you had
  open could have run shell commands through `/api/run`. Writes now require a JSON content type,
  foreign origins are rejected and preflights refused.
- Cross-platform: a macOS app bundle, plus `server-studio start` on Windows and Linux. CI opens a
  real terminal window and the native folder picker on each platform.
