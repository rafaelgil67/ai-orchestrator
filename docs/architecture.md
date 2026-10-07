# AI Software Factory — Architecture

Technical reference for the current implementation. Everything described
here exists in `src/`; nothing is aspirational.

## Overview

The orchestrator is a **deterministic state machine** (`AutonomyLoopEngine`)
composed over small, injectable services. `step()` performs exactly one
transition; `run()` iterates `step()` until a terminal decision or the
cycle budget is exhausted.

```
            ┌─────────────────────────────────────────────┐
            │           AutonomyLoopEngine                │
            │   step(): exactly one valid transition      │
            │   run():  step() × N, ≤ maxCycles           │
            └──┬──────┬──────┬──────┬──────┬──────┬───────┘
               │      │      │      │      │      │
        Strategic  Approval Planning  Exec   Verif.  Repair/
        Analysis   Gate               Sched/  Service Replan
        Service                       Exec           Services
               │      │      │      │      │      │
            └────────────► ProjectStateManager ◄──────────┘
                   tasks · decisions · metadata · autonomyTrace
```

## Lifecycle

```
createProject → discovery → diagnosis → approval (awaiting_approval)
   │
   │   approvalGate.approve()  — the ONLY way forward; records an
   ▼   explicit "approved" decision and sets planning/running
planning ──► execution ──► verification ──► completed
                ▲              │
                │          failure → RecoveryDecisionService.assess()
                │              ├─ repair  → affected tasks → ready → execution
                │              ├─ replan  → +corrective tasks      → execution
                │              ├─ block   → status=paused (human required)
                │              └─ fail    → phase=failed (terminal)
                └──────────── loop continues
```

### Terminal and stopped states

- `completed` — all tasks verified; `run()` stops. Further calls are no-ops.
- `failed` — terminal; resuming requires human authorization.
- `paused` — human intervention required (budget exhausted, retry
  deadlock, ambiguous failure, gate violation, contained exception).
- `awaiting_approval` — loop stops cleanly with `wait`.
- `blocked`/`stopped` — unhandled or out-of-scope phases
  (`deployment` is out of MVP scope and blocks cleanly).

## Components

### StrategicAnalysisService — `src/core/strategy/`
`analyze(brief)` drives the project through `discovery → diagnosis →
approval`. A `StrategicBrainEngine` (backed by any `AIProvider`) produces
a `StrategicBlueprint` (requirements, architecture, definition of done,
risks) which `BlueprintValidator` must accept before it's stored in
`project.metadata.strategicBlueprint`.

### ProjectApprovalGate — `src/core/governance/`
`approve()` / `reject()` are the only paths that record human intent as a
`decisions[]` entry. The gate also requires the project to be in
`approval`/`awaiting_approval` — you cannot approve a running project.

**The gate is verified, not inferred.** Before any `planning`,
`execution` or `verification` step, the engine checks
`project.decisions.some(d => d.decision === "approved")`. Mutating
`phase`/`status` directly to simulate approval gets the project paused
with `Approval Gate violated` in the trace — never executed.

### PlanningService + Planner — `src/core/planning/`
`plan()` runs exactly once per project (`planning`/`running` only), maps
the blueprint to dependency-ordered `ProjectTask`s, resolves synthetic
plan IDs to real task IDs, and transitions to `execution`. `TaskGraph`
models dependency order; the planner's output is deterministic.

### DefaultExecutionScheduler + DefaultExecutionEngine — `src/core/execution/`
`runNext()` executes every `pending`/`ready` task whose `dependsOn` are
all `completed` (stops the batch on first failure). `retryTask()`
re-executes a `failed` task iff `retryCount < maxRetries`. The executor
resolves an agent by capability via `AgentRegistry`, passes task inputs
(including `repairContext` when present) and records `attemptHistory`.

### VerificationService — `src/core/verification/`
Runs only when **all** tasks are `completed`. Produces a
`VerificationReport` (per-task `TaskVerification` + global findings) stored
in `metadata.verificationReport`. A `TaskVerifier` is injectable; each
verification entry may carry an optional classification:

```ts
kind?: "task_execution" | "plan_invalid" | "unknown"
```

### Recovery assessment — `src/core/repair/decision-service.ts`
After a failed verification the engine asks `RepairDecisionService`
(default: `DefaultRepairDecisionService`) for one of four decisions:

| Decision | Condition |
|---|---|
| `repair` | every finding classified `task_execution` (or unclassified) **and** clearly attributable to an existing `completed` task |
| `replan` | every finding classified `plan_invalid` (explicit only) |
| `block` | any `unknown` kind, mixed kinds, unattributable findings, exhausted budget, or identical findings signature (no progress) |
| `fail` | reserved for custom services — the default never emits it |

Conservative by rule: **when in doubt, `block` — never assume recovery.**

### Repair — task-level recovery
Affected tasks go back to `ready` with a `repairContext` (failed
findings, previous attempt summaries, cycle number, reason) that travels
into `AgentTask.inputs` — the agent knows *what* failed and *what* it
already tried. `attemptHistory` and `retryCount` are preserved; other
completed tasks are untouched.

### Replan — plan-level recovery
`ReplanService` inserts **new corrective tasks** — one per `plan_invalid`
finding — that depend only on the existing origin task (never on each
other, so cycles are impossible by construction). Validation is atomic:
if any finding references a non-existent task, **nothing is inserted**.
Original tasks and the blueprint are never modified.

## Retry vs Repair vs Replan

Three separate levels, three separate counters:

| Level | Trigger | Counter | What happens |
|---|---|---|---|
| **retry** | task execution fails | `retryCount` ≤ `maxRetries` (per task) | same task re-executed, `attemptHistory` grows |
| **repair** | verification fails on a completed task | `metadata.repairCount` ≤ `maxRepairs` (per project) | task → `ready` + `repairContext`, re-executed, re-verified |
| **replan** | verification says the plan itself is wrong | `metadata.replanCount` ≤ `maxReplans` (per project) | new corrective tasks appended; originals never reopen |

Defaults: `maxRetries=2` (per task), `maxRepairs=2`, `maxReplans=1`,
`maxCycles=50` (per `run()`; `maxReplans` is also overridable via
`AutonomyConfig`).

## No-progress detection

`findingsSignature` = sorted `taskId:finding` pairs of all failed
verifications, persisted as `metadata.lastFindingsSignature`. If two
consecutive verifications produce the same signature, the previous
recovery changed nothing → `block` + `paused`. This is the safety net
under both repair and replan; the budget limits are the outer bound.

## Traceability — `autonomyTrace`

Every `step()` appends exactly one entry:

```ts
{ cycle, phaseFrom, phaseTo, action, taskId?, agentId?, attempt?,
  outcome, reason, at }
```

`cycle` is derived from trace length; `action` ∈ `continue | retry |
block | wait | complete | fail | repair | replan`; `reason` always
carries technical detail (including the full task-ID list for multi-task
repairs and the inserted task IDs for replans). Per-task history also
lives in `attemptHistory` (agent, attempt number, success, summary).

## Error containment

Everything actionable inside `step()` (plan, schedule, retry, verify)
runs in a single `try/catch`. An exception produces a traced `block`
with the original error message and `status=paused` — the next `run()`
terminates in one cycle instead of repeating the failing operation.

## Interactive Web Demo Layer — `src/web/` + `public/`

A thin transport/presentation layer that exposes the real engine to a
browser. It adds no orchestration logic — every behavior above still
comes from the core.

```
Browser (public/ — vanilla JS + EventSource)
   │ HTTP + JSON                    │ SSE
   ▼                                ▲
HTTP router (server.ts, node:http — zero deps)
   │
   ├─ validation.ts  strict input whitelist, body/Content-Type checks
   ├─ sessions.ts    DemoSessionService — one isolated core stack per
   │                 session, per-session run mutex, TTL cleanup,
   │                 session/IP/SSE-listener caps, 25s heartbeat
   └─ dto.ts         read-only serialization of core state
        │
        ▼
   buildCoreStack() → ProjectStateManager + strategy + approval gate
                      + AutonomyLoopEngine + scheduler/executor/verifier
                      + repair/replan services   (identical composition
                      as the CLI demo, one per session)
```

Key properties:

- The web layer is **transport, session, validation and presentation
  only** — it does not implement planning, execution, retry, repair,
  replan, verification or budgets. `engine.step()` stays in the core.
- Each session gets an **isolated core stack**; sessions share no
  mutable state.
- SSE emits events **derived from real state** (state, task, trace,
  phase, decision, done) — including catch-up events on connect and a
  non-event heartbeat.
- The frontend **cannot skip the Approval Gate** — approval goes through
  `ProjectApprovalGate.approve()` and the engine re-verifies it.
- The layer makes **no modifications to the core**; deleting `src/web/`
  leaves the engine untouched.

## Extension points

- `Agent` — real executors (Devin, CI workers, …)
- `AIProvider` — real strategic brains
- `TaskVerifier` — real QA/acceptance verification
- `RepairDecisionService` — smarter recovery classification
- `ReplanService` — planner-driven corrective replanning
- `ProjectStateManager` — persistence adapter (state is currently
  in-memory; the manager is the single seam to replace)

## Explicit non-goals (current MVP)

No authentication/authorization · no persistence · no parallel
execution · no event sourcing · no deployment phase · no real provider
adapters. The web layer is a demo frontend, not a public product API.
