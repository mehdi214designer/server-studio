# Server Studio usage counter

The receiver for the app's anonymous ping. A Cloudflare Worker + a D1 database.
Free tier is far more than enough. Nothing here is published to npm.

## What gets counted

The app sends one small JSON ping on `install` and on every `start` (launch):

```json
{ "event": "start", "id": "<random-uuid>", "v": "1.1.1", "os": "darwin", "arch": "arm64", "node": "20" }
```

No usernames, no paths, no project data. The Worker never stores the IP. `unique`
counts are distinct random ids = real machines. npm mirrors, CDNs and CI never run
the app, so they never reach this — which is exactly why these numbers are truer
than the npm download count.

## Deploy (one time)

You need a Cloudflare account and `npm i -g wrangler`, then from this folder:

```bash
# 1. create the database, copy the printed database_id into wrangler.toml
wrangler d1 create server-studio-analytics

# 2. create the table (remote db)
wrangler d1 execute server-studio-analytics --remote --file schema.sql

# 3. set the secret that guards /stats (any long random string)
wrangler secret put STATS_TOKEN

# 4. ship it
wrangler deploy
```

Deploy prints your URL, e.g. `https://server-studio-analytics.<you>.workers.dev`.

## Turn the counter on

The app ships **inert** — it sends nothing until it knows the URL. Point it at your
Worker's `/collect`, then publish a new version:

- Either edit `src/telemetry.js` → `ANALYTICS_URL = 'https://…workers.dev/collect'`
- Or leave the code alone and ship with the env var set at build/publish time.

Only installs from that new version onward are counted (older ones stay silent).

## Read your numbers and your list

The token goes in an **Authorization header, never the URL** (URLs leak through logs,
history and referrers — a header does not):

```bash
# usage stats
curl -H "Authorization: Bearer YOUR_STATS_TOKEN" \
  "https://server-studio-analytics.<you>.workers.dev/stats"

# your email signups
curl -H "Authorization: Bearer YOUR_STATS_TOKEN" \
  "https://server-studio-analytics.<you>.workers.dev/emails"
```

`/stats` returns installs (total + unique + last 7d), active users (1d/7d/30d), a
Mac/Windows/Linux split, and subscriber count. `/emails` returns your signup list.

## Locking it down (recommended for the email list)

The Bearer token is the code-level gate: requests without the exact token get `401`,
the compare is constant-time, and it fails closed if `STATS_TOKEN` is unset. To make
these endpoints genuinely unreachable by anyone but you, add **Cloudflare Access** (Zero
Trust, free tier) in front of `/stats` and `/emails`:

1. Cloudflare dashboard → Zero Trust → Access → Applications → Add a self-hosted app
2. Path: your Worker's `/stats` and `/emails`
3. Policy: allow only your email (one-time login link or Google)

With Access on, the endpoints require your identity login *before* the request even
reaches the Worker — a leaked token alone is useless. Use a long random `STATS_TOKEN`
regardless (e.g. `openssl rand -hex 32`).

## Opt-out (already built in)

Anyone can silence the ping with `SERVER_STUDIO_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`,
and it never runs under `CI`. Document this in your main README so it's transparent.
