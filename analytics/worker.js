// Server Studio anonymous usage counter — Cloudflare Worker.
//
// Routes:
//   GET  /            the private dashboard page (asks for the token, then shows numbers)
//   POST /collect     one anonymous ping from the app. No IP kept. Open by necessity.
//   GET  /stats       aggregate counts.   Requires  Authorization: Bearer <STATS_TOKEN>
//   GET  /emails      your signup list.   Requires  Authorization: Bearer <STATS_TOKEN>
//   GET  /requests    feature requests.    Requires  Authorization: Bearer <STATS_TOKEN>
//
// The two read endpoints take the token in a header, never the URL, and compare it in
// constant time. Storage is a D1 (SQLite) database bound as `DB`. See README.md.
'use strict';

const EVENTS = new Set(['install', 'start', 'uninstall']);
const OK_OS = new Set(['darwin', 'win32', 'linux']);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Keep only clean, short, expected values. Anything odd is dropped, not stored.
function clean(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[^\w.\-]/g, '').slice(0, max);
}

/* ---------- auth for the read endpoints (/stats, /emails) ---------- */
// The token is required in an Authorization header, NEVER the URL. URLs leak through
// logs, browser history and referrers; headers do not. The compare is constant-time
// (over SHA-256 digests) so the token can't be recovered by timing the response.
async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
}
async function ctEq(a, b) {
  const ha = await sha256(a), hb = await sha256(b);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}
async function authed(req, env) {
  if (!env.STATS_TOKEN) return false;                    // no token configured: fail closed
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return false;                                  // must be a Bearer header, not ?token=
  return ctEq(m[1], env.STATS_TOKEN);
}

async function collect(req, env) {
  let b;
  try { b = await req.json(); } catch (e) { return json({ ok: false }, 400); }
  if (!b || !EVENTS.has(b.event)) return json({ ok: false }, 400);

  const id = clean(b.id, 40);
  if (id.length < 8) return json({ ok: false }, 400);

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  await env.DB.prepare(
    'INSERT INTO events (id, event, v, os, arch, node, day, ts) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(
    id,
    b.event,
    clean(b.v, 20),
    OK_OS.has(b.os) ? b.os : 'other',
    clean(b.arch, 12),
    clean(b.node, 4),
    day,
    now
  ).run();

  return new Response(null, { status: 204 }); // nothing to tell the app
}

// Read-only. Nothing writes to these tables any more: signups and requests go to
// the site's own /api/subscribe. Kept so any rows collected before that still read.
async function requests(req, env) {
  if (!(await authed(req, env))) return json({ error: 'unauthorized' }, 401);
  const rows = await env.DB.prepare(
    'SELECT email, message, os, day, ts FROM requests ORDER BY ts DESC LIMIT 500'
  ).all();
  return json({ count: rows.results.length, requests: rows.results });
}

async function emails(req, env) {
  if (!(await authed(req, env))) return json({ error: 'unauthorized' }, 401);
  const rows = await env.DB.prepare(
    'SELECT email, os, day FROM emails ORDER BY ts DESC'
  ).all();
  return json({ count: rows.results.length, emails: rows.results });
}

async function stats(req, env) {
  if (!(await authed(req, env))) return json({ error: 'unauthorized' }, 401);
  const q = sql => env.DB.prepare(sql).first('n');
  const dayCut = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  const [
    installsTotal, installsUnique,
    startsTotal, usersEver,
    dau, wau, mau,
    installs7,
  ] = await Promise.all([
    q("SELECT COUNT(*) n FROM events WHERE event='install'"),
    q("SELECT COUNT(DISTINCT id) n FROM events WHERE event='install'"),
    q("SELECT COUNT(*) n FROM events WHERE event='start'"),
    q("SELECT COUNT(DISTINCT id) n FROM events WHERE event='start'"),
    q(`SELECT COUNT(DISTINCT id) n FROM events WHERE event='start' AND day >= '${dayCut(1)}'`),
    q(`SELECT COUNT(DISTINCT id) n FROM events WHERE event='start' AND day >= '${dayCut(7)}'`),
    q(`SELECT COUNT(DISTINCT id) n FROM events WHERE event='start' AND day >= '${dayCut(30)}'`),
    q(`SELECT COUNT(DISTINCT id) n FROM events WHERE event='install' AND day >= '${dayCut(7)}'`),
  ]);

  const osRows = await env.DB.prepare(
    "SELECT os, COUNT(DISTINCT id) n FROM events WHERE event='start' GROUP BY os ORDER BY n DESC"
  ).all();

  let subscribers = 0;
  try { subscribers = await q('SELECT COUNT(*) n FROM emails'); } catch (e) {}

  return json({
    installs:    { total: installsTotal, unique: installsUnique, unique_last_7d: installs7 },
    users:       { unique_ever: usersEver, active_1d: dau, active_7d: wau, active_30d: mau },
    subscribers,
    by_os:       osRows.results,
    note: 'unique = distinct anonymous install ids. mirrors/CI never reach here, so these are real machines.',
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      return new Response(DASHBOARD, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (req.method === 'POST' && url.pathname === '/collect') return collect(req, env);
    if (req.method === 'GET' && url.pathname === '/stats') return stats(req, env);
    if (req.method === 'GET' && url.pathname === '/emails') return emails(req, env);
    if (req.method === 'GET' && url.pathname === '/requests') return requests(req, env);
    return json({ error: 'not found' }, 404);
  },
};

// ---------- the private dashboard page ----------
// Public HTML, but shows nothing until the correct token is entered (checked by the
// server on every /stats and /emails call). The token is kept only in sessionStorage,
// sent as an Authorization header, and never put in the URL.
const DASHBOARD = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Server Studio · Stats</title>
<style>
  :root{--bg:#0c0d10;--card:#16181f;--card2:#1b1e27;--border:#24262f;--text:#e7e9ee;--dim:#9aa0ad;--faint:#636978;--accent:#6d8bff;--green:#3ecf8e;--radius:14px}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;padding:40px 24px 80px;background-image:radial-gradient(900px 500px at 80% -10%,rgba(109,139,255,.06),transparent 60%)}
  .wrap{max-width:1040px;margin:0 auto}
  h1{font-size:22px;font-weight:650;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
  h1 .dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(62,207,142,.14)}
  h2{font-size:14px;font-weight:600;color:var(--dim);margin:34px 0 14px;letter-spacing:-.01em}
  input,button{font-family:inherit}
  .btn{font-size:13.5px;font-weight:600;border:1px solid var(--border);background:var(--card);color:var(--text);padding:10px 16px;border-radius:10px;cursor:pointer;transition:all .15s}
  .btn:hover{background:var(--card2);border-color:#313440}
  .btn-primary{background:var(--accent);border-color:var(--accent);color:#0b0d12}
  .btn-primary:hover{background:#7e98ff;border-color:#7e98ff}
  /* login */
  .login{max-width:360px;margin:14vh auto 0;text-align:center}
  .login p{color:var(--dim);font-size:13.5px;margin:10px 0 22px}
  .login input{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:14px;outline:none;text-align:center}
  .login input:focus{border-color:var(--accent)}
  .login .btn{width:100%;margin-top:10px}
  .err{color:#f0556a;font-size:12.5px;min-height:16px;margin-top:12px}
  /* app */
  header.bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:20px}
  .tile{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px}
  .tile .n{font-size:30px;font-weight:680;letter-spacing:-.02em}
  .tile .l{color:var(--dim);font-size:12.5px;margin-top:5px}
  .tile .s{color:var(--faint);font-size:11.5px;margin-top:2px}
  .os{display:flex;flex-direction:column;gap:10px}
  .os .row{display:flex;align-items:center;gap:12px;font-size:13px}
  .os .name{width:80px;color:var(--dim)}
  .os .track{flex:1;display:block;height:8px;background:var(--card);border:1px solid var(--border);border-radius:6px;overflow:hidden}
  .os .fill{display:block;height:100%;background:var(--accent);border-radius:6px}
  .os .val{width:44px;text-align:right;color:var(--dim)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:var(--faint);font-weight:500;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;padding:0 12px 10px}
  td{padding:11px 12px;border-top:1px solid var(--border)}
  tbody tr:hover{background:var(--card)}
  .muted{color:var(--faint);font-size:13px;padding:16px 0}
</style></head>
<body>
<div class="wrap">
  <div class="login" id="login">
    <h1 style="justify-content:center"><span class="dot"></span> Server Studio</h1>
    <p>Enter your access token to view your numbers.</p>
    <input id="tok" type="password" placeholder="Access token" autocomplete="off" spellcheck="false">
    <button class="btn btn-primary" id="go">Unlock</button>
    <div class="err" id="err"></div>
  </div>

  <div id="app" hidden>
    <header class="bar">
      <h1><span class="dot"></span> Server Studio · Stats</h1>
      <button class="btn" id="lock">Lock</button>
    </header>
    <div class="grid" id="cards"></div>
    <h2>Where they run</h2>
    <div class="os" id="os"></div>
    <h2>Requests (<span id="reqn">0</span>)</h2>
    <div id="reqBox"></div>

    <h2>Email signups (<span id="subn">0</span>)</h2>
    <div id="emailsBox"></div>
  </div>
</div>

<script>
(function(){
  var login=document.getElementById('login'), app=document.getElementById('app');
  var tokInput=document.getElementById('tok'), err=document.getElementById('err');

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function n(x){ return (x==null?0:x).toLocaleString(); }

  function get(path, token){
    return fetch(path, { headers: { 'Authorization': 'Bearer ' + token } }).then(function(r){
      if(r.status===401) throw new Error('unauthorized');
      if(!r.ok) throw new Error('failed');
      return r.json();
    });
  }

  function tile(num, label, sub){
    return '<div class="tile"><div class="n">'+n(num)+'</div><div class="l">'+esc(label)+'</div>'+(sub?'<div class="s">'+esc(sub)+'</div>':'')+'</div>';
  }

  function render(stats, list, reqs){
    var u=stats.users||{}, i=stats.installs||{};
    document.getElementById('cards').innerHTML =
      tile(i.unique, 'Unique installs', n(i.total)+' total') +
      tile(u.active_7d, 'Active this week', 'distinct machines, 7d') +
      tile(u.active_30d, 'Active this month', '30d') +
      tile(stats.subscribers, 'Email signups', '');

    var os=(stats.by_os||[]); var max=1;
    os.forEach(function(o){ if(o.n>max) max=o.n; });
    var pretty={darwin:'macOS',win32:'Windows',linux:'Linux',other:'Other'};
    document.getElementById('os').innerHTML = os.length ? os.map(function(o){
      var w=Math.round((o.n/max)*100);
      return '<div class="row"><span class="name">'+esc(pretty[o.os]||o.os)+'</span><span class="track"><span class="fill" style="width:'+w+'%"></span></span><span class="val">'+n(o.n)+'</span></div>';
    }).join('') : '<div class="muted">No launches yet.</div>';

    var emails=(list.emails||[]);
    document.getElementById('subn').textContent=n(list.count||emails.length);
    document.getElementById('emailsBox').innerHTML = emails.length ?
      '<table><thead><tr><th>Email</th><th>OS</th><th>Joined</th></tr></thead><tbody>'+
      emails.map(function(e){ return '<tr><td>'+esc(e.email)+'</td><td>'+esc(e.os)+'</td><td>'+esc(e.day)+'</td></tr>'; }).join('')+
      '</tbody></table>' :
      '<div class="muted">No signups yet.</div>';

    // What people actually asked for. This is the half worth reading.
    var rs=((reqs&&reqs.requests)||[]);
    var rn=document.getElementById('reqn'); if(rn) rn.textContent=n(rs.length);
    var box=document.getElementById('reqBox');
    if(box) box.innerHTML = rs.length ?
      rs.map(function(r){
        return '<div class="req"><div class="req-head"><b>'+esc(r.email)+'</b><span class="muted">'+esc(r.day)+'</span></div>'+
               '<div class="req-msg">'+esc(r.message)+'</div></div>';
      }).join('') :
      '<div class="muted">No requests yet.</div>';
  }

  function unlock(token){
    err.textContent='';
    return Promise.all([ get('/stats', token), get('/emails', token), get('/requests', token) ]).then(function(res){
      sessionStorage.setItem('ss_tok', token);
      login.hidden=true; app.hidden=false;
      render(res[0], res[1], res[2]);
    }).catch(function(e){
      sessionStorage.removeItem('ss_tok');
      if(e.message==='unauthorized') err.textContent='Wrong token.';
      else err.textContent='Could not load. Try again.';
    });
  }

  document.getElementById('go').onclick=function(){ if(tokInput.value.trim()) unlock(tokInput.value.trim()); };
  tokInput.addEventListener('keydown', function(e){ if(e.key==='Enter' && tokInput.value.trim()) unlock(tokInput.value.trim()); });
  document.getElementById('lock').onclick=function(){ sessionStorage.removeItem('ss_tok'); location.reload(); };

  var saved=sessionStorage.getItem('ss_tok');
  if(saved) unlock(saved); else tokInput.focus();
})();
</script>
</body></html>`;
