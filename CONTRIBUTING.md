# Contributing to AI Software Factory

Thanks for your interest. This is an **experimental research project** —
design feedback, issues and focused PRs are welcome.

## Requirements

- Node.js 20+ (developed on Node 24)
- npm
- No API keys, credentials or external services — everything runs in
  memory with mock components.

## Setup

```bash
git clone <repo-url>
cd ai-orchestrator
npm install
```

## Verify your environment

```bash
npm run build   # TypeScript compile → dist/
npm test        # all suites, each in a fresh process
npm run dev     # in-memory demo of the full loop
```

All three must pass before proposing changes.

## Ground rules

- **Never commit secrets** — no `.env`, keys, tokens or credentials.
  `.gitignore` covers them; keep it that way.
- **Preserve the safety model** — the Approval Gate, finite budgets and
  no-progress detection are the point of the project. Changes that
  weaken them need explicit justification.
- **Keep it additive** — `repair`, `replan` and the agent/provider
  contracts are extension points; prefer implementing behind them over
  modifying the core loop.
- **Tests travel with changes** — new behavior needs a suite under
  `tests/` that `npm test` picks up automatically (files ending in
  `-test.ts`).

## Proposing changes

1. Open an issue describing the problem and the proposed approach —
   especially for anything touching `AutonomyLoopEngine`, the safety
   model or the recovery engines.
2. Small fixes (docs, typos, tests) can go straight to a PR.
3. Keep PRs focused; the project evolves in explicit phases.

## Status reminder

Mock providers only — no real Devin/OpenAI/Claude integration exists.
Contributions toward provider adapters are welcome, but the core must
stay provider-agnostic.
