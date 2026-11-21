import type { Hour, Snapshot, TargetStatus } from './store';

/** The checker runs every 5 minutes; older than this and the page says so. */
export const STALE_MS = 15 * 60_000;

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const iso = (ms: number) => new Date(ms).toISOString();

/** `2026-11-20 14:05 UTC`: the page has no script, so it can't show the reader's own time. */
export const utc = (ms: number) => `${iso(ms).slice(0, 16).replace('T', ' ')} UTC`;

export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

export function percent(share: number | null): string {
  if (share === null) return '–';
  if (share === 1) return '100%';
  // Never round a failure up to 100%.
  return `${(Math.floor(share * 1000) / 10).toFixed(1)}%`;
}

/** `/status.json`: the same as the page, with ISO times for scripts. */
export function toJson(snapshot: Snapshot | null, now: number) {
  if (!snapshot) return { up: null, checkedAt: null, stale: true, targets: [] };
  return {
    up: snapshot.targets.every((t) => t.up),
    checkedAt: iso(snapshot.checkedAt),
    stale: now - snapshot.checkedAt > STALE_MS,
    targets: snapshot.targets.map((t) => ({
      name: t.name,
      url: t.url,
      up: t.up,
      status: t.status,
      ms: t.ms,
      error: t.error,
      since: iso(t.since),
      uptime24h: t.uptime24h,
      uptime7d: t.uptime7d,
      lastFailure: t.lastFailure && { ...t.lastFailure, at: iso(t.lastFailure.at) },
      hours: t.hours.map((h) => ({ start: iso(h.start), checks: h.checks, up: h.ups })),
    })),
  };
}

function bar(hour: Hour): string {
  const kind = !hour.checks ? 'none' : hour.ups === hour.checks ? 'ok' : hour.ups ? 'some' : 'down';
  const label = hour.checks
    ? `${utc(hour.start)}: ${hour.ups} of ${hour.checks} checks answered`
    : `${utc(hour.start)}: no checks`;
  return `<li class="${kind}" title="${escape(label)}"></li>`;
}

function row(target: TargetStatus, now: number): string {
  const state = target.up ? 'Up' : 'Down';
  const detail = target.up
    ? `${target.ms} ms`
    : escape(target.error ?? (target.status ? `HTTP ${target.status}` : 'No answer'));
  const failure = target.lastFailure
    ? `Last failure ${utc(target.lastFailure.at)}${
        target.lastFailure.error ? `: ${escape(target.lastFailure.error)}` : ''
      }`
    : 'No failures in these results';
  const failed = target.hours.filter((h) => h.checks && h.ups < h.checks).length;
  return `<li class="target ${target.up ? 'is-up' : 'is-down'}">
  <div class="head">
    <h2>${escape(target.name)}</h2>
    <p class="state"><span class="dot" aria-hidden="true"></span>${state}<span class="detail"> · ${detail}</span></p>
  </div>
  <p class="meta"><span>${state} for ${duration(now - target.since)}</span><span>24 h ${percent(target.uptime24h)}</span><span>7 days ${percent(target.uptime7d)}</span></p>
  <ol class="bars" aria-label="Last 24 hours: ${failed ? `${failed} of 24 hours had failures` : 'no failures'}">${target.hours.map(bar).join('')}</ol>
  <p class="meta"><span>${failure}</span><a href="${escape(target.url)}" rel="nofollow noreferrer">${escape(new URL(target.url).host)}</a></p>
</li>`;
}

export function renderPage(snapshot: Snapshot | null, now: number): string {
  const targets = snapshot?.targets ?? [];
  const down = targets.filter((t) => !t.up);
  const stale = !snapshot || now - snapshot.checkedAt > STALE_MS;
  const headline = !snapshot
    ? 'No checks yet'
    : !targets.length
      ? 'Nothing to check'
      : down.length
        ? down.length === 1
          ? `${down[0]?.name ?? ''} is down`
          : `${down.length} of ${targets.length} are down`
        : 'Everything answers';
  const checked = snapshot
    ? `Checked ${utc(snapshot.checkedAt)}, every 5 minutes.${
        stale
          ? ` That is ${duration(now - snapshot.checkedAt)} ago: the checker itself may be stuck.`
          : ''
      }`
    : 'The first check runs within 5 minutes of a deploy.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(headline)} · Lelap status</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <p class="brand">Lelap status</p>
  <h1 class="${down.length ? 'bad' : stale ? 'warn' : 'good'}">${escape(headline)}</h1>
  <p class="sub">${checked}</p>
  <ul class="targets">
${targets.map((t) => row(t, now)).join('\n')}
  </ul>
  <p class="foot">Each bar is an hour, oldest on the left. Results are kept for 7 days. As JSON: <a href="/status.json">status.json</a>.</p>
</main>
</body>
</html>`;
}

// The site's night and day colours (apps/site/src/styles), without web fonts: no outside requests.
const STYLE = `
:root{color-scheme:light dark;--bg:light-dark(#f8f5ef,#0d0e11);--surface:light-dark(#ebe6db,#17191f);
--line:light-dark(#c9c0ad,#2a2e37);--fg:light-dark(#1c1a16,#f3f1ec);--muted:light-dark(#5d574d,#a3a8b2);
--accent:light-dark(#8a5300,#f5b041);--ok:light-dark(#1d7146,#6bd49a);--down:light-dark(#b3261e,#ff8a80);
--some:light-dark(#c98100,#f5b041)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:46rem;margin:0 auto;padding:clamp(24px,6vw,56px) 16px}
a{color:var(--accent)}
.brand{margin:0;color:var(--accent);font-weight:600;letter-spacing:.02em}
h1{margin:.25rem 0 0;font-size:clamp(1.75rem,5vw,2.5rem);line-height:1.15}
h1.good{color:var(--ok)}h1.bad{color:var(--down)}h1.warn{color:var(--accent)}
.sub,.foot{color:var(--muted)}
.foot{font-size:.875rem;margin-top:2rem}
.targets{list-style:none;margin:2rem 0 0;padding:0;display:grid;gap:12px}
.target{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px}
.head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 16px}
h2{margin:0;font-size:1.125rem}
.state{margin:0;font-weight:600}
.is-up .state{color:var(--ok)}.is-down .state{color:var(--down)}
.detail{color:var(--muted);font-weight:400}
.dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:currentColor;margin-right:.45em}
.meta{margin:8px 0 0;display:flex;flex-wrap:wrap;gap:4px 16px;color:var(--muted);font-size:.875rem;overflow-wrap:anywhere}
.bars{list-style:none;margin:12px 0 0;padding:0;display:grid;grid-template-columns:repeat(24,1fr);gap:3px}
.bars li{height:28px;border-radius:3px;background:var(--line)}
.bars .ok{background:var(--ok)}.bars .some{background:var(--some)}.bars .down{background:var(--down)}
`;
