// Repair Engine MVP — repair phase.
// Verifies: attributable repair → ready → re-execution → re-verification;
// maxRepairs; no-progress detection; trace; gate intact.
//   npx tsx tests/autonomy-repair-test.ts
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

/** Fails each task ONLY on the first verification → repair + success. */
class FailOncePerTaskVerifier implements TaskVerifier {
  private failed = new Set<string>();
  verifyTask(task: ProjectTask): TaskVerification {
    if (!this.failed.has(task.id)) {
      this.failed.add(task.id);
      return { taskId: task.id, passed: false, findings: ["first-check failure"] };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

/** Always fails tasks of a given role; stable finding (no progress). */
class FailRoleVerifier implements TaskVerifier {
  constructor(private role: string, private label: (n: number) => string) {}
  private rounds = 0;
  beginRound() { this.rounds++; }
  verifyTask(task: ProjectTask): TaskVerification {
    if (task.role === this.role) {
      return { taskId: task.id, passed: false, findings: [this.label(this.rounds)] };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

function build(verifier?: TaskVerifier, maxRepairs?: number) {
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
    undefined, maxRepairs
  );
  return { stateManager, strategicService, approvalGate, engine, agent };
}

async function approvedProject(sys: ReturnType<typeof build>) {
  const r = await sys.strategicService.analyze({
    projectName: "Repair Test",
    prompt: "Project to test the repair engine."
  });
  sys.approvalGate.approve(r.project.id, "approved in test");
  return r.project;
}

console.log("\nRepair Engine MVP — tests\n");

// 1+2+5+6. Repairable verification → repair → ready → re-execution →
// completed, with correct repairCount and traceability.
await t("repairable verification failure → repair → completed", async () => {
  const sys = build(new FailOncePerTaskVerifier());
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "completed", `expected completed, got ${run.stoppedReason}`);
  assert(run.decisions.includes("repair"), `no repair decision: ${run.decisions}`);
  const p = sys.stateManager.getProject(project.id);
  assert(p.metadata.repairCount === 1, `repairCount=${p.metadata.repairCount} ≠ 1`);
  assert(p.phase === "completed" && p.status === "completed", "project did not complete after repair");
  // The 8 repaired tasks were re-executed (2 history entries).
  assert(p.tasks.every(task => task.attemptHistory.length === 2),
    "repaired tasks do not have 2 attempts in attemptHistory");
  // The agent received the repairContext on the second execution.
  const secondExec = sys.agent.receivedTasks[8]; // first repair retry
  assert(secondExec?.inputs?.repairContext, "the agent did not receive repairContext");
  const repairTrace = (p.autonomyTrace ?? []).find(e => e.action === "repair");
  assert(repairTrace?.taskId && repairTrace.reason && repairTrace.cycle > 0 &&
    repairTrace.outcome === "repair_scheduled",
    `incorrect repair trace: ${JSON.stringify(repairTrace)}`);
});

// 1 (focus) — during repair the affected task goes back to "ready".
await t("repair → the affected task returns to ready", async () => {
  const verifier = new FailRoleVerifier("testing", () => "single-task finding");
  const sys = build(verifier);
  const project = await approvedProject(sys);
  // Step by step until the repair decision; intermediate inspection.
  let step;
  do {
    verifier.beginRound();
    step = await sys.engine.step(project.id);
  } while (!step.terminal && step.decision !== "repair");
  assert(step.decision === "repair", `expected repair, got ${step.decision}`);
  const p = sys.stateManager.getProject(project.id);
  const fixed = p.tasks.find(task => task.role === "testing");
  assert(fixed?.status === "ready", `repaired task did not end up ready: ${fixed?.status}`);
  assert(fixed?.repairContext?.repairCycle === 1, "missing repairContext or wrong cycle");
  assert(fixed!.attemptHistory.length === 1, "attemptHistory was improperly reset");
  assert(p.phase === "execution", "the phase did not return to execution");
  assert(p.tasks.filter(task => task.status === "ready").length === 1,
    "unaffected tasks were reopened");
});

// 3. Repair without persistent progress with VARIABLE findings → maxRepairs.
await t("repairs exhausted → maxRepairs → paused", async () => {
  // Different findings each round → never noProgress; exhausts the
  // repair budget (maxRepairs=2).
  const verifier = new FailRoleVerifier("testing", n => `round-${n} failure`);
  const sys = build(verifier, 2);
  const project = await approvedProject(sys);
  let step;
  do {
    verifier.beginRound();
    step = await sys.engine.step(project.id);
  } while (!step.terminal);
  assert(step.decision === "block", `expected block, got ${step.decision}`);
  const p = sys.stateManager.getProject(project.id);
  assert(p.status === "paused", `project not paused: ${p.status}`);
  assert(p.metadata.repairCount === 2, `repairCount=${p.metadata.repairCount} ≠ 2`);
  const repairs = (p.autonomyTrace ?? []).filter(e => e.action === "repair");
  assert(repairs.length === 2, `expected 2 repairs, got ${repairs.length}`);
});

// 4. Consecutive identical findings → noProgress → block + paused.
await t("identical findings → noProgress → immediate block", async () => {
  const verifier = new FailRoleVerifier("testing", () => "always the same");
  const sys = build(verifier);
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `expected paused/blocked, got ${run.stoppedReason}`);
  const last = (sys.stateManager.getProject(project.id).autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /no progress/i.test(last.reason),
    `unexpected reason: ${last?.reason}`);
  // Only 1 repair: the second identical verification blocks.
  assert(sys.stateManager.getProject(project.id).metadata.repairCount === 1,
    "repairCount should have stayed at 1");
});

// 7. Without approval the gate still protects even with a pending repair.
await t("no approved decision → block even when a repair is available", async () => {
  const sys = build(new FailOncePerTaskVerifier());
  const r = await sys.strategicService.analyze({
    projectName: "Gate Test",
    prompt: "Project without approval with a repairable failure."
  });
  // Force verification+running without approve() → C3 blocks first.
  sys.stateManager.updatePhase(r.project.id, "verification");
  sys.stateManager.updateStatus(r.project.id, "running");
  const run = await sys.engine.run(r.project.id);
  assert(run.cycles === 1, `should have blocked in 1 cycle, got ${run.cycles}`);
  const p = sys.stateManager.getProject(r.project.id);
  assert(p.status === "paused" && !run.decisions.includes("repair"),
    `repair ran without approval: ${run.decisions}`);
  assert(sys.agent.receivedTasks.length === 0, "tasks were executed without approval");
});

console.log(`\n${ok} PASSED · ${fail} FAILED\n`);
if (fail > 0) process.exit(1);
