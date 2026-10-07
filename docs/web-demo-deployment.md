# Interactive Web Demo — Deployment Notes

Practical guide for putting `npm run start:web` behind a public URL.
This is platform-agnostic; no provider-specific config is included.

## Requirements

- **Node 20+** and npm.
- **A persistent process** — sessions live entirely in memory. Static
  hosts (GitHub Pages) and serverless-only platforms cannot run it.

## Build & run

```bash
npm ci
npm run build      # tsc → dist/
npm test           # optional but recommended — 13 suites
npm run start:web  # node dist/web/server.js
```

## Files that must be deployed

| Path | Why |
|---|---|
| `dist/` | compiled server (`dist/web/server.js` is the entry point) |
| `public/` | static frontend — **required**; resolved relative to `dist/web/` (or `src/web/` in dev) |
| `package.json`, `package-lock.json` | runtime metadata / reproducible install |

The compiled server expects `public/` in the same position relative to
itself as in the repo layout. Missing `public/` → frontend returns 404.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Set it to whatever the platform assigns. |
| `TRUST_PROXY` | disabled | Enable **only** behind a reverse proxy you control that correctly sets `X-Forwarded-For`. It affects the per-IP session cap; enabling it with an untrusted proxy lets clients spoof IPs. |

## Reverse proxy / HTTPS

- Terminate **HTTPS at the proxy or platform layer** — the app speaks
  plain HTTP.
- The app uses **Server-Sent Events** on `GET /api/demo/:id/events`:
  - disable response buffering — nginx: `proxy_buffering off;`
    (the app also sends `X-Accel-Buffering: no`, which nginx honors);
  - keep proxy idle timeouts ≥ the 25 s heartbeat the app already emits
    (default nginx `proxy_read_timeout` 60 s is fine);
  - ensure the proxy forwards `X-Forwarded-For` and set `TRUST_PROXY`
    accordingly.

## Health & lifecycle

- Health check: `GET /api/health` → `{"status":"ok"}`.
- Sessions are ephemeral: they expire after ~30 min of inactivity and
  are **all lost on restart** — plan for restarts to drop active demos.
- No graceful shutdown handler is implemented; the impact of a kill is
  limited to active ephemeral sessions, which is acceptable for the
  demo's purpose.
- Resource bounds are enforced in-app: ≤10 sessions, ≤3 per IP,
  ≤5 SSE listeners per session / ≤50 total, 16 KB request bodies.

## Data warning (repeat to your users)

The demo stores every brief you enter **in process memory** and serves
it back over the API/SSE to anyone holding the `sessionId` (which acts
as a capability token). Sessions are wiped by TTL/restart — but
**do not enter confidential or personal data**.

## Pre-publication checklist

- [ ] `npm ci` clean install
- [ ] `npm run build` → 0 errors
- [ ] `npm test` → 13/13 suites
- [ ] `public/` present next to `dist/`
- [ ] `PORT` set to platform value
- [ ] HTTPS terminated at proxy/platform
- [ ] SSE unbuffered through the proxy; heartbeat visible (`curl -N`
      shows `: ping` every ~25 s)
- [ ] `TRUST_PROXY` matching the real proxy setup
- [ ] `GET /api/health` monitored
- [ ] Restart behavior understood (sessions lost — by design)
