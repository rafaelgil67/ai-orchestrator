// Replan Engine MVP — plan_invalid → additive corrective tasks.
// Verified rules: completed tasks are never touched, deps only point to
// existing tasks, maxReplans, noProgress, gate intact, full trace.
//   npx tsx tests/autonomy-replan-test.ts
import { ProjectStateManager } from "../src/core/project-state/manager.js";
import { StrategicAnalysisService } from "../src/core/strategy/service.js";
import { StrategicBrainEngine } from "../src/core/strategy/engine.js";
import { BlueprintValidator } from "../src/core/strategy/validator.js";
import { ProjectApprovalGate } from "../src/core/governance/project-approval-gate.js";
import { PlanningService } from "../src/core/planning/planning-service.js";
import { Planner } from "../src/core/planning/planner.js";
import { AgentRegistry } from "../src/agents/providers/agent-registry.js";
import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
import { DefaultExecutionEngine } from "../src/core/execution/executor.js";
import { DefaultExecutionScheduler } from "../src/core/execution/scheduler.js";
import { VerificationService } from "../src/core/verification/verification-service.js";
import { AutonomyLoopEngine } from "../src/core/autonomy/autonomy-engine.js";
import { TraceAgent } from "./trace-agent.js";
import { ProjectTask } from "../src/core/project-state/types.js";
import {
  TaskVerification,
  TaskVerifier
} from "../src/core/verification/contracts.js";

let ok = 0;
let fail = 0;
function t(nombre: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { ok++; console.log(`  PASS  ${nombre}`); })
    .catch((e: Error) => { fail++; console.log(`  FAIL  ${nombre}: ${e.message}`); });
}
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };

/** plan_invalid ONCE on a role → replan → success. */
class PlanInvalidOnceVerifier implements TaskVerifier {
  private fired = false;
  constructor(private role: string) {}
  verifyTask(task: ProjectTask): TaskVerification {
    if (!this.fired && task.role === this.role) {
      this.fired = true;
      return {
        taskId: task.id, passed: false,
        findings: ["plan missing coverage for this role"],
        kind: "plan_invalid"
      };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

/** plan_invalid ALWAYS on the SAME original task (fixed finding). */
class PlanInvalidPersistentVerifier implements TaskVerifier {
  private target: string | null = null;
  constructor(private label: (n: number) => string, private role: string) {}
  private n = 0;
  verifyTask(task: ProjectTask): TaskVerification {
    // Only attacks the first captured task of the role — new corrective
    // tasks pass cleanly → stable signature if the finding is constant.
    if (task.role === this.role && !task.title.startsWith("[REPLAN]")) {
      this.target = this.target ?? task.id;
      if (task.id === this.target) {
        return {
          taskId: task.id, passed: false,
          findings: [this.label(++this.n)],
          kind: "plan_invalid"
        };
      }
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

/** plan_invalid pointing at a nonexistent task → invalid replan. */
class PlanInvalidGhostVerifier implements TaskVerifier {
  private fired = false;
  verifyTask(task: ProjectTask): TaskVerification {
    if (!this.fired) {
      this.fired = true;
      return {
        taskId: "task_ghost_nonexistent", passed: false,
        findings: ["references a task that does not exist"],
        kind: "plan_invalid"
      };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

/** Fails once per task without kind → task_execution → repair. */
class FailOnceVerifier implements TaskVerifier {
  private failed = new Set<string>();
  verifyTask(task: ProjectTask): TaskVerification {
    if (!this.failed.has(task.id)) {
      this.failed.add(task.id);
      return { taskId: task.id, passed: false, findings: ["exec flaw"] };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

function build(verifier?: TaskVerifier, maxReplans?: number) {
  const agent = new TraceAgent();
  const stateManager = new ProjectStateManager();
  const strategicBrain = new StrategicBrainEngine(new MockAIProvider(), new BlueprintValidator());
  const strategicService = new StrategicAnalysisService(stateManager, strategicBrain);
  const approvalGate = new ProjectApprovalGate(stateManager);
  const planningService = new PlanningService(stateManager, new Planner());
  const agentRegistry = new AgentRegistry();
  agentRegistry.register(agent);
  const executor = new DefaultExecutionEngine(stateManager, agentRegistry);
  const scheduler = new DefaultExecutionScheduler(stateManager, executor);
  const verificationService = new VerificationService(stateManager, verifier);
  const engine = new AutonomyLoopEngine(
    stateManager, planningService, scheduler, verificationService,
    undefined, undefined, undefined, maxReplans
  );
  return { stateManager, strategicService, approvalGate, engine, agent };
}

async function approvedProject(sys: ReturnType<typeof build>) {
  const r = await sys.strategicService.analyze({
    projectName: "Replan Test",
    prompt: "Project to test the replan engine."
  });
  sys.approvalGate.approve(r.project.id, "approved in test");
  return r.project;
}

console.log("\nReplan Engine MVP — tests\n");

// 1+2+3+4+5+6+12+13. plan_invalid → replan → new tasks → completed.
await t("plan_invalid → replan → corrective tasks → completed", async () => {
  const sys = build(new PlanInvalidOnceVerifier("testing"));
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "completed", `expected completed, got ${run.stoppedReason}`);
  assert(run.decisions.includes("replan"), `no replan decision: ${run.decisions}`);

  const p = sys.stateManager.getProject(project.id);
  assert(p.metadata.replanCount === 1, `replanCount=${p.metadata.replanCount} ≠ 1`);

  // Corrective tasks are identifiable by prefix; the rest are original.
  const added = p.tasks.filter(x => x.title.startsWith("[REPLAN]"));
  const originalTasks = p.tasks.filter(x => !x.title.startsWith("[REPLAN]"));
  const originalIds = new Set(originalTasks.map(x => x.id));
  assert(added.length === 1, `expected 1 corrective task, got ${added.length}`);
  assert(originalTasks.length === 8, `expected 8 original tasks, got ${originalTasks.length}`);
  assert(originalTasks
    .every(x => x.status === "completed"), "an original task left the completed state");

  // Original tasks were NOT re-executed (1 attempt); corrective executed.
  assert(originalTasks
    .every(x => x.attemptHistory.length === 1), "an original task was re-executed");
  assert(added[0].attemptHistory.length === 1, "the corrective task was not executed");
  assert(added[0].status === "completed", "the corrective task did not complete");

  // Correct dep: only points to existing tasks.
  assert(added[0].dependsOn.every(d => originalIds.has(d)),
    `invalid dependency: ${added[0].dependsOn}`);

  // Complete replan trace.
  const trace = (p.autonomyTrace ?? []).find(e => e.action === "replan");
  assert(trace?.cycle > 0 && trace.phaseFrom === "verification" &&
    trace.phaseTo === "execution" && /added tasks/.test(trace.reason),
    `incorrect replan trace: ${JSON.stringify(trace)}`);
});

// 7. maxReplans=1 → second replan → paused.
await t("maxReplans exhausted → block + paused", async () => {
  const verifier = new PlanInvalidPersistentVerifier(n => `plan flaw ${n}`, "testing");
  const sys = build(verifier); // maxReplans default = 1
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `expected paused/blocked, got ${run.stoppedReason}`);
  const p = sys.stateManager.getProject(project.id);
  assert(p.status === "paused", `project not paused: ${p.status}`);
  assert(p.metadata.replanCount === 1, `replanCount=${p.metadata.replanCount} ≠ 1`);
  const replans = (p.autonomyTrace ?? []).filter(e => e.action === "replan");
  assert(replans.length === 1, `expected 1 replan, got ${replans.length}`);
});

// 8. Identical findings → noProgress → block + paused (no infinite replan).
await t("identical findings post-replan → noProgress → paused", async () => {
  const verifier = new PlanInvalidPersistentVerifier(() => "same flaw", "testing");
  const sys = build(verifier);
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  const p = sys.stateManager.getProject(project.id);
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /no progress/i.test(last.reason),
    `unexpected reason: ${last?.reason}`);
  assert(p.status === "paused", `project not paused: ${p.status}`);
  assert(p.metadata.replanCount === 1, "replanCount should have stayed at 1");
});

// 9. Finding on a nonexistent taskId → invalid replan → block, no inserts.
await t("nonexistent dependency → replan rejected → block without inserting", async () => {
  const sys = build(new PlanInvalidGhostVerifier());
  const project = await approvedProject(sys);
  await sys.engine.run(project.id);
  const p = sys.stateManager.getProject(project.id);
  assert(p.status === "paused", `project not paused: ${p.status}`);
  const corrective = p.tasks.filter(x => x.title.startsWith("[REPLAN]"));
  assert(corrective.length === 0,
    `${corrective.length} tasks were inserted after an invalid replan`);
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /Replan refused/.test(last.reason),
    `unexpected reason: ${last?.reason}`);
});

// 10. Replan without approved → the gate blocks before anything else.
await t("forced verification without approved → block, replan never runs", async () => {
  const sys = build(new PlanInvalidOnceVerifier("testing"));
  const r = await sys.strategicService.analyze({
    projectName: "Gate Replan",
    prompt: "Project without approval with a plan_invalid failure."
  });
  sys.stateManager.updatePhase(r.project.id, "verification");
  sys.stateManager.updateStatus(r.project.id, "running");
  const run = await sys.engine.run(r.project.id);
  assert(run.cycles === 1, `should have blocked in 1 cycle, got ${run.cycles}`);
  assert(!run.decisions.includes("replan"), `replan ran without approval`);
  const p = sys.stateManager.getProject(r.project.id);
  assert(p.status === "paused", `project not paused: ${p.status}`);
});

// 11. Repair still works — no regression.
await t("repair (without kind) still works — no regression", async () => {
  const sys = build(new FailOnceVerifier());
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "completed", `repair regression: ${run.stoppedReason}`);
  assert(run.decisions.includes("repair") && !run.decisions.includes("replan"),
    `unexpected decisions: ${run.decisions}`);
});

// 14. maxCycles still bounds the loop.
await t("run with maxCycles=1 → max_cycles even with replan available", async () => {
  const sys = build(new PlanInvalidOnceVerifier("testing"));
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id, { maxCycles: 1 });
  assert(run.stoppedReason === "max_cycles", `expected max_cycles, got ${run.stoppedReason}`);
  assert(run.cycles === 1, `cycles=${run.cycles} ≠ 1`);
});

console.log(`\n${ok} PASSED · ${fail} FAILED\n`);
if (fail > 0) process.exit(1);
