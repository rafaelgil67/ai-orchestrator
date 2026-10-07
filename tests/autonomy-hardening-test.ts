// Autonomy Loop Hardening — C1/C2/C3 fixes from the diagnosis.
//   C1: exceptions contained, traced and terminal (plan/verify/etc.)
//   C2: execution without work → immediate block, never maxCycles
//   C3: planning/execution/verification require an "approved" decision
//   npx tsx tests/autonomy-hardening-test.ts
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
import { Agent } from "../src/agents/contracts/agent.js";
import { TaskVerifier } from "../src/core/verification/contracts.js";

let ok = 0;
let fail = 0;
function t(nombre: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { ok++; console.log(`  PASS  ${nombre}`); })
    .catch((e: Error) => { fail++; console.log(`  FAIL  ${nombre}: ${e.message}`); });
}
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };

class ExplodingVerifier implements TaskVerifier {
  verifyTask(): never {
    throw new Error("verifier exploded");
  }
}

function build(agent: Agent, verifier?: TaskVerifier) {
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
    stateManager, planningService, scheduler, verificationService
  );
  return { stateManager, strategicService, approvalGate, engine };
}

async function analyzedProject(strategicService: StrategicAnalysisService) {
  const r = await strategicService.analyze({
    projectName: "Hardening Test",
    prompt: "Project to test loop hardening."
  });
  return r.project;
}

console.log("\nAutonomy Loop — hardening (C1/C2/C3)\n");

// C1a — exception during planning: contained, traced, project paused.
await t("C1: exception in plan() → traced block + paused (no crash)", async () => {
  const agent = new TraceAgent();
  const { stateManager, strategicService, approvalGate, engine } = build(agent);
  const project = await analyzedProject(strategicService);
  approvalGate.approve(project.id);
  // Blueprint removed after approval → plan() throws.
  stateManager.setMetadata(project.id, "strategicBlueprint", undefined);
  const run = await engine.run(project.id);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `expected paused/blocked, got ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `project not paused: ${p.status}`);
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && last.outcome === "error",
    `incorrect final trace: ${JSON.stringify(last)}`);
  assert(/blueprint/i.test(last!.reason), "the reason does not preserve the error message");
  assert(agent.receivedTasks.length === 0, "tasks were executed after the error");
});

// C1b — throwing TaskVerifier → contained, traced, terminal.
await t("C1: throwing TaskVerifier → traced block + paused", async () => {
  const agent = new TraceAgent();
  const { stateManager, engine, approvalGate, strategicService } =
    build(agent, new ExplodingVerifier());
  const project = await analyzedProject(strategicService);
  approvalGate.approve(project.id);
  const run = await engine.run(project.id);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `expected paused/blocked, got ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `project not paused: ${p.status}`);
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && last.outcome === "error" &&
    last.phaseFrom === "verification",
    `incorrect final trace: ${JSON.stringify(last)}`);
  // The next run() does not repeat the failed operation.
  const run2 = await engine.run(project.id);
  assert(run2.cycles === 1 && run2.stoppedReason === "paused",
    "run() on a paused project did not finish in 1 cycle");
});

// C2 — execution+running with no tasks → immediate block, not max_cycles.
await t("C2: execution with no tasks → immediate block", async () => {
  const agent = new TraceAgent();
  const { stateManager, strategicService, approvalGate, engine } = build(agent);
  const project = await analyzedProject(strategicService);
  approvalGate.approve(project.id);
  // Force empty execution (simulates an empty plan): bypassing plan().
  stateManager.updatePhase(project.id, "execution");
  const run = await engine.run(project.id, { maxCycles: 50 });
  assert(run.cycles === 1, `should have blocked in 1 cycle, got ${run.cycles}`);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `expected paused/blocked, got ${run.stoppedReason}`);
  assert(stateManager.getProject(project.id).status === "paused",
    "project did not end up paused");
  const last = (stateManager.getProject(project.id).autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /no work|deadlock/i.test(last.reason),
    `unexpected reason: ${last?.reason}`);
});

// C3 — forced planning+running without approval → blocked, nothing runs.
await t("C3: planning+running without approved decision → block", async () => {
  const agent = new TraceAgent();
  const { stateManager, strategicService, engine } = build(agent);
  const project = await analyzedProject(strategicService);
  // Direct gate bypass: approve() was never called.
  stateManager.updatePhase(project.id, "planning");
  stateManager.updateStatus(project.id, "running");
  const run = await engine.run(project.id);
  assert(run.cycles === 1, `should have blocked in 1 cycle, got ${run.cycles}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `project not paused: ${p.status}`);
  assert(p.tasks.length === 0, "tasks were planned without approval");
  assert(agent.receivedTasks.length === 0, "tasks were executed without approval");
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /approval/i.test(last.reason),
    `unexpected reason: ${last?.reason}`);
});

// C3b — forced execution without approval → equally blocked.
await t("C3: execution+running without approved decision → block", async () => {
  const agent = new TraceAgent();
  const { stateManager, strategicService, engine } = build(agent);
  const project = await analyzedProject(strategicService);
  stateManager.updatePhase(project.id, "execution");
  stateManager.updateStatus(project.id, "running");
  const run = await engine.run(project.id);
  assert(run.cycles === 1, `should have blocked in 1 cycle, got ${run.cycles}`);
  assert(agent.receivedTasks.length === 0, "tasks were executed without approval");
  assert(stateManager.getProject(project.id).status === "paused", "project not paused");
});

// Extra — run() ≈ N×step() equivalence: same decisions, same state.
await t("run() ≡ sequence of step()", async () => {
  const a1 = new TraceAgent();
  const s1 = build(a1);
  const p1 = await analyzedProject(s1.strategicService);
  s1.approvalGate.approve(p1.id);
  const run = await s1.engine.run(p1.id);

  const a2 = new TraceAgent();
  const s2 = build(a2);
  const p2 = await analyzedProject(s2.strategicService);
  s2.approvalGate.approve(p2.id);
  const decisions = [];
  let step;
  do {
    step = await s2.engine.step(p2.id);
    decisions.push(step.decision);
  } while (!step.terminal);

  assert(run.stoppedReason === "completed", `run() did not complete: ${run.stoppedReason}`);
  assert(run.decisions.join() === decisions.join(),
    `decisions differ: ${run.decisions} vs ${decisions}`);
  assert(s2.stateManager.getProject(p2.id).phase === "completed",
    "manual step() did not complete the project");
});

// Extra — verification failure → repair → no progress → persistently
// paused (post-Repair MVP the project no longer ends in failed here).
await t("verification without progress → persistently paused across runs", async () => {
  const failVerifier: TaskVerifier = {
    verifyTask: (task: { id: string }) => ({
      taskId: task.id, passed: false, findings: ["rejected"]
    })
  };
  const agent = new TraceAgent();
  const { stateManager, strategicService, approvalGate, engine } =
    build(agent, failVerifier);
  const project = await analyzedProject(strategicService);
  approvalGate.approve(project.id);
  const run1 = await engine.run(project.id);
  assert(run1.stoppedReason === "paused" || run1.stoppedReason === "blocked",
    `expected paused/blocked, got ${run1.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `project did not end up paused: ${p.status}`);
  const executions = agent.receivedTasks.length;
  const run2 = await engine.run(project.id);
  assert(run2.cycles === 1 && run2.stoppedReason === "paused",
    "run() on paused did not finish in 1 cycle");
  assert(agent.receivedTasks.length === executions, "re-executed after blocking");
});

// Extra — full traceability in wait and block.
await t("full traceability in wait/block decisions", async () => {
  const { stateManager, strategicService, engine } = build(new TraceAgent());
  const project = await analyzedProject(strategicService);
  await engine.run(project.id); // wait terminal
  const waitTrace = (stateManager.getProject(project.id).autonomyTrace ?? [])[0];
  assert(waitTrace && waitTrace.cycle === 1 && waitTrace.action === "wait" &&
    waitTrace.phaseFrom === "approval" && waitTrace.phaseTo === "approval" &&
    waitTrace.reason && waitTrace.at,
    `incomplete wait trace: ${JSON.stringify(waitTrace)}`);
});

console.log(`\n${ok} PASSED · ${fail} FAILED\n`);
if (fail > 0) process.exit(1);
