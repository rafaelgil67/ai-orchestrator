# AI Software Factory

**An experimental, open-source autonomous software orchestration platform** —
it coordinates specialized AI agents through a controlled cycle of planning,
execution, verification, repair and replanning.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/suites-15%2F15%20passing-brightgreen.svg)](#testing)
[![Status](https://img.shields.io/badge/status-experimental-orange.svg)](#current-status)

> **Status: active research MVP.** The full orchestration loop works
> end-to-end today — running on mock agents and providers. Real provider
> integrations (Devin, OpenAI, Claude, …) are future adapters behind the
> existing contracts; they do **not** exist yet.

## The problem

Autonomous software demos tend to fail the same ways: they retry forever,
restart the whole plan on any failure, quietly skip human approval, or die
on the first exception. AI Software Factory explores the opposite core:
**a bounded, auditable, conservative autonomy loop** — every transition is
traced, every budget is finite, every ambiguous failure pauses for a human.

## What it does today

- Turns a project brief into a validated **strategic blueprint**.
- Requires an **explicit human approval** before anything executes.
- Generates a dependency-ordered plan and executes it through
  capability-matched agents.
- **Verifies** every completed task.
- On failure, picks the right level of recovery — **repair** the task or
  **replan** the plan — or pauses for a human when it's not sure.
- Records **every transition** in a per-project autonomy trace.
- Runs the whole thing as a **reproducible local demo** — via CLI
  (`npm run dev`) or via an **interactive web demo** (`npm run demo`)
  — with `MockAIProvider` + `MockAgent`, no credentials, no side effects.

What it does **not** do yet: execute real projects via external agents,
persist state, authenticate users, or run as a hosted service. Those are
the roadmap — see [From GitHub project to SaaS](#from-github-project-to-saas).

## The autonomy loop

```
ANALYZE → APPROVE → PLAN → EXECUTE → VERIFY → complete
                              ↑        │
                              │        └─ failure → assess
                              │                    ├─ repair   (task-level)
                              │                    ├─ replan   (plan-level)
                              │                    ├─ block    (→ human)
                              │                    └─ fail     (terminal)
                              └────────── re-execute only what's needed
```

`step()` performs exactly one transition; `run()` iterates it under a hard
`maxCycles` budget. `step()` and `run()` are provably equivalent — same
traces, same state.

### Repair vs Replan

- **Repair** — a completed task failed verification. It goes back to
  `ready` carrying a `repairContext` (what failed, what was already
  tried), re-executes, and is verified again. `retryCount` and
  `attemptHistory` are preserved; all other tasks stay completed.
- **Replan** — the verifier reports the *plan itself* is invalid
  (`kind: "plan_invalid"`). New corrective tasks are appended — never
  editing or reopening existing ones — with dependencies validated
  atomically before insertion.
- **Block** — anything ambiguous, unclassifiable, budget-exhausted or
  unchanged after recovery → `paused` for human review. When in doubt,
  the engine never guesses.

### Safety model

- **Approval Gate is verified, not inferred** — `planning`/`execution`/
  `verification` all require a recorded `approved` decision. Mutating
  state directly to skip approval → project paused, nothing executes.
- **Finite budgets** — `maxCycles` (loop) · `maxRetries` (per task) ·
  `maxRepairs` · `maxReplans` (per project). Nothing loops forever.
- **No-progress detection** — identical verification findings twice in a
  row ⇒ recovery produced nothing ⇒ pause.
- **Exception containment** — a failure inside any step is caught, traced
  and becomes a controlled pause — never an uncontrolled crash.
- **No silent auto-approval** — approving is always an explicit call.

## Quick start

```bash
git clone <repo-url>
cd ai-orchestrator
npm install
```

Requires Node.js 20+ (developed on Node 24) and npm. No `.env`, accounts
or API keys needed — the demo is fully self-contained.

## Run the demo

```bash
npm run dev
```

Expected output — a demo project runs the entire loop and dumps its
autonomy trace:

```
== AI Software Factory demo ==
Brief: Demo Project

[1] ANALYZE — generating strategic blueprint…
    project project_… → approval/awaiting_approval
[2] APPROVE — human approval recorded via Approval Gate
[3] RUN — autonomy loop (plan → execute → verify → recover)

Result: completed in 9 cycle(s)
Final: completed/completed — 8/8 tasks completed

Autonomy trace (9 entries):
  [ 1] planning → execution | continue | planned
  …
  [ 9] verification → completed | complete | completed
```

The demo uses `MockAIProvider` for strategy and `MockAgent` for every
task — it demonstrates the loop mechanics (dependencies, verification,
recovery, tracing), not real code generation.

## Interactive Web Demo

The same engine is also available as a browser experience — a thin web
layer over the **real core**, wired by composition, with zero duplicated
orchestration logic:

```bash
npm run demo       # dev server → http://localhost:3000
```

or production-like, from the compiled build:

```bash
npm run build
npm run start:web  # node dist/web/server.js → http://localhost:3000
```

Flow in the browser:

```
Brief → Analyze → Strategic Analysis → Approval Gate
      → Planning → Execution → Verification → Completed
```

- **The Approval Gate is mandatory** — the engine stops and waits for an
  explicit Approve/Reject click; nothing executes without it.
- The loop runs **step-driven** (`engine.step()` per cycle), so progress
  is visible between transitions.
- Live updates stream over **SSE** (Server-Sent Events): state, task,
  trace, phase, decision and done events.
- Tasks and the **autonomy trace** are rendered from real core state.
- Each browser session gets its own **isolated core stack** — sessions
  never share mutable state.
- Sessions are **in-memory and ephemeral**: they expire after ~30 minutes
  of inactivity and are destroyed on server restart. There is **no
  persistence and no database**.

> **Warning — this is a public/experimental demo.** Do not enter
> confidential information, credentials, personal data, client data,
> policies, trade secrets or any other sensitive information into the
> brief. Everything you type lives in server memory for the life of the
> session and is visible to anyone who holds the session identifier.
>
> **`sessionId` is a capability token by design**: whoever has it can
> view and control that session while it lives. This is acceptable for an
> ephemeral demo — it is **not** authentication and must not be treated
> as such.

## Build & test

```bash
npm run build   # tsc → dist/
npm test        # all 15 suites, each in a fresh process
```

## Project layout

```
src/
  agents/          Agent & AIProvider contracts, registry, mocks
  core/
    strategy/      strategic analysis, blueprint validation
    governance/    approval gate
    planning/      planner, task graph, planning service
    execution/     scheduler, executor
    verification/  verification service, task verifier contract
    repair/        conservative recovery assessment, findings signature
    replanning/    additive corrective-planning service
    autonomy/      loop engine, decisions, trace contracts
    project-state/ state manager, project/task types
  workspace/       WorkspaceManager — isolated ephemeral dirs per
                   session (Phase A: fs only, no code execution)
  web/             interactive demo layer (zero-dependency node:http)
    server.ts      HTTP router, statics, SSE endpoint, security headers
    sessions.ts    session service: isolation, mutex, TTL, caps, heartbeat
    validation.ts  strict input whitelist, body/Content-Type checks
    dto.ts         read-only serialization of core state for the UI
    errors.ts      stable JSON error contract
    node-shims.d.ts minimal ambient Node typings (no @types/node dep)
public/            demo frontend (vanilla HTML/CSS/JS + EventSource)
tests/             15 independent suites + run-all runner
docs/              architecture deep-dive + deployment notes
```

## Architecture

| Layer | Component | Responsibility |
|---|---|---|
| Strategy | `StrategicAnalysisService` | brief → validated blueprint |
| Governance | `ProjectApprovalGate` | explicit human approve/reject |
| Planning | `PlanningService` / `Planner` | blueprint → task graph |
| Execution | `Scheduler` / `Executor` | dependency-aware dispatch to agents |
| Agents | `AgentRegistry` / `Agent` | capability-matched executors |
| Verification | `VerificationService` | per-task pass/fail + findings |
| Recovery | `RepairDecisionService` | repair / replan / block / fail |
| | `ReplanService` | additive corrective tasks |
| Autonomy | `AutonomyLoopEngine` | deterministic state machine |
| Trace | `autonomyTrace` | every transition, fully recorded |

Full details — state machine, safety budgets, trace schema, extension
points — in **[docs/architecture.md](docs/architecture.md)**.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port for the web demo server. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for client IP (used by the per-IP session cap). Enable **only** when the app runs behind a reverse proxy you control that correctly sets/overwrites the header — otherwise clients could spoof their IP and bypass the cap. Do not enable it just because the platform has a proxy; enable it when that proxy is properly configured and trusted. |
| `AI_PROVIDER` | `mock` | Strategic-analysis provider. `mock` = synthetic blueprints (also what the public demo runs). `omniroute` = real LLM calls through an OmniRoute gateway — local/dev only. `groq` = direct Groq API (OpenAI-compatible, strict structured output). |
| `OMNIROUTE_URL` | — | Base URL of an OmniRoute gateway (e.g. `http://localhost:20128`). Required when `AI_PROVIDER=omniroute`. |
| `OMNIROUTE_API_KEY` | — | Optional bearer token for a secured OmniRoute instance. Never commit real keys. |
| `OMNIROUTE_MODEL` | `auto` | Model id passed to OmniRoute. |
| `GROQ_API_KEY` | — | Required when `AI_PROVIDER=groq` (direct Groq, no gateway). Server-side secret — never commit it. |
| `AI_MODEL` | `openai/gpt-oss-120b` | Groq model id when `AI_PROVIDER=groq`. |

Both are optional — the demo runs with zero configuration. Portable
example (Linux/macOS; on Windows set the variable via your shell):

```bash
PORT=3000 npm run start:web
TRUST_PROXY=true npm run start:web
```

## Security Model

Controls that exist in the web layer today:

- strict input whitelist — only `brief`, `projectName`, `rationale`
  cross the API boundary;
- request body limit (16 KB) and per-field limits (brief 4 KB,
  name 120 chars, rationale 500 chars);
- the Approval Gate is enforced by the core engine, not by the UI;
- session isolation — one independent core stack per session;
- capacity caps: 10 concurrent sessions, 3 per client IP;
- SSE listener caps (5 per session, 50 process-wide) and a 25-second
  heartbeat;
- JSON `Content-Type` validation (`415` on mismatches);
- strict CSP, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`;
- path traversal protection on static files;
- sanitized API errors — no stack traces, no internals;
- no external service calls, no persistent storage, no secrets required.

What it deliberately does **not** have: authentication, per-user
authorization, request-level rate limiting, persistence, user audit, or
enterprise-grade protection. It is an experimental demo, not a SaaS.

## Deployment

The web demo needs a **persistent Node 20+ process** — sessions live in
memory, so serverless-only platforms and static hosts (e.g. GitHub
Pages) are not suitable.

Requirements:

- Node 20+ and npm;
- `PORT` for the platform-assigned port;
- `public/` deployed together with the runtime (`dist/`,
  `package.json`, `package-lock.json` and installed dependencies);
- HTTPS provided by the platform / reverse proxy;
- a reverse proxy that does not buffer SSE (e.g. nginx:
  `proxy_buffering off;`) — the app already sends a heartbeat every 25
  seconds and sets `X-Accel-Buffering: no`;
- `TRUST_PROXY=true` **only** when the proxy is correctly configured
  and controlled (see [Environment Variables](#environment-variables)).

```bash
npm ci
npm run build
npm test
npm run start:web
```

Conceptually compatible: Render, Railway, Fly.io, VPS + nginx — any
platform that runs a persistent Node process. Practical notes in
**[docs/web-demo-deployment.md](docs/web-demo-deployment.md)**.

## Current status

Working: the complete loop above — mocked end-to-end — in both the CLI
(`npm run dev`) and the interactive web demo (`npm run demo`), with
15/15 test suites green (including 51 web-layer assertions) and
reproducible from a clean clone.

Not yet: real provider adapters, persistence, authentication,
multi-user authorization, parallel execution, resume-from-paused.

## Roadmap

**Phase 1 — Core orchestration** ✅ done
planning · execution · verification · approval gate · retry · repair ·
replan · autonomy trace

**Phase 2 — Provider adapters**
Devin adapter · OpenAI adapter · Anthropic adapter · pluggable providers

**Phase 3 — Persistence**
project persistence · execution history · audit/event log

**Phase 4 — Web application** (interactive demo ✅ done — full app pending)
dashboard · projects · tasks · agent activity · approval center ·
live execution trace

**Phase 5 — SaaS**
authentication · multi-tenancy · usage limits · billing · hosted
execution · public API

## From GitHub project to SaaS

The intended trajectory of this repository:

```
open-source orchestration engine
  → provider adapters (real agents)
    → persistence + audit log
      → authentication / tenants
        → web dashboard
          → usage limits + billing
            → hosted SaaS
```

This is a **roadmap, not a feature list** — the repo today contains the
core loop plus the interactive web demo layer, mocked end-to-end.

## Limitations

- Experimental MVP — mock providers, no real LLM planning or code
  execution.
- No authentication; `sessionId` acts as a capability token (see above).
- Sessions are in-memory — restart destroys all active sessions and
  there is no persistent database.
- Never enter sensitive data into the demo.
- No request-level rate limiter; abuse is mitigated primarily through
  session, per-IP and SSE-listener caps.
- Public deployment should terminate HTTPS at the reverse proxy /
  platform layer.
- A persistent Node process is required — serverless-only deployment is
  not supported.
- `public/` must be deployed together with the application runtime.
- Graceful shutdown is not implemented — acceptable here because
  sessions are ephemeral; a restart only loses active demo sessions.
- Sequential execution — independent tasks are not parallelized.
- Recovery classification needs a verifier that reports `kind`; plain
  string findings default to the repair path.
- A `paused` project needs manual intervention — no resume API yet.

## Contributing

Experimental research code — issues and design feedback welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md). The `Agent` / `AIProvider` /
`TaskVerifier` contracts are the intended extension points.

## License

[MIT](LICENSE)
