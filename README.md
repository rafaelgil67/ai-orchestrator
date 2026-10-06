# AI Software Factory

**An experimental, open-source autonomous software orchestration platform** —
it coordinates specialized AI agents through a controlled cycle of planning,
execution, verification, repair and replanning.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/suites-12%2F12%20passing-brightgreen.svg)](#testing)
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
- Runs the whole thing as a **reproducible local demo** with
  `MockAIProvider` + `MockAgent` — no credentials, no side effects.

What it does **not** do yet: execute real projects via external agents,
persist state, expose an API, or run as a hosted service. Those are the
roadmap — see [From GitHub project to SaaS](#from-github-project-to-saas).

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

## Build & test

```bash
npm run build   # tsc → dist/
npm test        # all 12 suites, each in a fresh process
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
tests/             12 independent suites + run-all runner
docs/              architecture deep-dive
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

## Current status

Working: the complete loop above, mocked end-to-end, 12/12 test suites
green, `npm run dev` reproducible from a clean clone.

Not yet: real provider adapters, persistence, API/UI, parallel
execution, resume-from-paused.

## Roadmap

**Phase 1 — Core orchestration** ✅ done
planning · execution · verification · approval gate · retry · repair ·
replan · autonomy trace

**Phase 2 — Provider adapters**
Devin adapter · OpenAI adapter · Anthropic adapter · pluggable providers

**Phase 3 — Persistence**
project persistence · execution history · audit/event log

**Phase 4 — Web application**
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

This is a **roadmap, not a feature list** — the repo today contains only
Phase 1, plus the contracts the later phases plug into.

## Limitations

- In-memory only — state is lost on exit.
- Mock providers — no real LLM planning or code execution.
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
