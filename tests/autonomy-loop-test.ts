// Autonomy Loop Engine — loop phase MVP.
// Covers: gate never skipped, valid transitions, bounded retry,
// dependencies, verification before completion, maxCycles, traceability.
//   npx tsx tests/autonomy-loop-test.ts
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
import { FailureRetryAgent } from "./failure-retry-agent.js";
import {
  Agent,
  AgentTask,
  AgentResult,
  AgentCapability
} from "../src/agents/contracts/agent.js";
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

// Agent that always fails — to test maxRetries exhaustion.
class AlwaysFailAgent implements Agent {
  readonly id = "always-fail-agent";
  readonly name = "Always Fail Agent";
  readonly provider = "test";
  readonly capabilities: AgentCapability[] = [
    "requirements", "architecture", "coding", "database",
    "uiux", "testing", "security", "devops"
  ];
  readonly executionMode = "synchronous" as const;
  executions = 0;
  canHandle() { return true; }
  async execute(task: AgentTask): Promise<AgentResult> {
    this.executions++;
    return {
      success: false,
      summary: `Permanent failure in "${task.title}".`,
      outputs: {},
      artifacts: [],
      issues: ["permanent failure"]
    };
  }
}

class FailVerifier implements TaskVerifier {
  verifyTask(task: { id: string }) {
    return { taskId: task.id, passed: false, findings: ["verification rejected"] };
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
    projectName: "Autonomy Test",
    prompt: "Build a test app for the autonomous loop."
  });
  return r.project;
}

async function approvedProject(agent: Agent, verifier?: TaskVerifier) {
  const sys = build(agent, verifier);
  const project = await analyzedProject(sys.strategicService);
  sys.approvalGate.approve(project.id, "approved in test");
  return { ...sys, project };
}

console.log("\nAutonomy Loop Engine — tests\n");

// 1. Unapproved project → the loop stops cleanly, nothing executes.
await t("unapproved project → clean wait, no execution", async () => {
  const sys = build(new TraceAgent());
  const project = await analyzedProject(sys.strategicService);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "awaiting_approval", `expected awaiting_approval, got ${run.stoppedReason}`);
  assert(run.cycles === 1, `expected 1 cycle, got ${run.cycles}`);
  const p = sys.stateManager.getProject(project.id);
  assert(p.phase === "approval" && p.status === "awaiting_approval", "the loop altered the approval state");
  assert(p.tasks.length === 0, "tasks were planned without approval");
});

// 2+3. Approved → plans, executes, verifies, completes; correct decisions.
await t("approved → ANALYZE→APPROVE→PLAN→EXECUTE→VERIFY→COMPLETE", async () => {
  const { engine, stateManager, project } = await approvedProject(new TraceAgent());
  const run = await engine.run(project.id);
  assert(run.stoppedReason === "completed", `expected completed, got ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.phase === "completed" && p.status === "completed", `incorrect final phase: ${p.phase}/${p.status}`);
  assert(p.tasks.every(task => task.status === "completed"), "there are uncompleted tasks");
  assert(run.decisions.every(d => d !== "retry" && d !== "fail"), `unexpected decisions: ${run.decisions}`);
});

// 4. Failure → explicit retry, the task ends up completed.
await t("task failure → retry until success", async () => {
  const failAgent = new FailureRetryAgent(); // fails the 1st, succeeds the 2nd
  const { engine, stateManager, project } = await approvedProject(failAgent);
  const run = await engine.run(project.id);
  assert(run.stoppedReason === "completed", `expected completed, got ${run.stoppedReason}`);
  assert(run.decisions.includes("retry"), `no retry decision: ${run.decisions}`);
  const retried = stateManager.getProject(project.id).tasks.find(task => task.retryCount > 0);
  assert(retried && retried.status === "completed" && retried.retryCount === 1, "the retry was not recorded correctly");
  assert(failAgent.receivedTasks.length === 8 + 1, `expected 9 executions (8 tasks + 1 retry), got ${failAgent.receivedTasks.length}`);
});

// 5. Exhausted retry → blocked + paused, no infinite loop.
await t("retry exhausted → task blocked, project paused (no infinite loop)", async () => {
  const agent = new AlwaysFailAgent();
  const { engine, stateManager, project } = await approvedProject(agent);
  const run = await engine.run(project.id, { maxCycles: 50 });
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked", `expected paused/blocked, got ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `project did not end up paused: ${p.status}`);
  const task = p.tasks.find(x => x.status === "blocked");
  assert(task, "no task ended up blocked");
  assert(task!.retryCount === task!.maxRetries, `retryCount=${task!.retryCount} ≠ maxRetries=${task!.maxRetries}`);
  assert(task!.attempts === 1 + task!.maxRetries, `attempts=${task!.attempts} ≠ 1+maxRetries`);
  assert(agent.executions === 1 + task!.maxRetries, `the agent ran ${agent.executions} times, expected ${1 + task!.maxRetries}`);
  assert(run.cycles <= 10, `too many cycles: ${run.cycles}`);
});

// 6. Dependencies respected inside the loop.
await t("dependencies respected during the loop", async () => {
  const agent = new TraceAgent();
  const { engine, stateManager, project } = await approvedProject(agent);
  await engine.run(project.id);
  const p = stateManager.getProject(project.id);
  const order = agent.receivedTasks.map(task => task.id);
  for (const task of p.tasks) {
    for (const dep of task.dependsOn) {
      assert(order.indexOf(dep) !== -1 && order.indexOf(dep) < order.indexOf(task.id),
        `task ${task.id} ran before its dependency ${dep}`);
    }
  }
});

// 7+8. Failed verification → repair (MVP) → no progress → paused,
// never completed; successful verification → completed.
await t("failed verification → repair without progress → paused, never completed", async () => {
  const { engine, stateManager, project } = await approvedProject(new TraceAgent(), new FailVerifier());
  const run = await engine.run(project.id);
  // Repair MVP: attributable findings → repair → same signature →
  // noProgress → block + paused. It NO LONGER ends in failed directly.
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `expected paused/blocked, got ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused" && p.phase !== "completed",
    `incorrect final state: ${p.phase}/${p.status}`);
  assert(run.decisions.includes("repair"), `no repair decision: ${run.decisions}`);
});

// 9. maxCycles bounds the loop.
await t("run with maxCycles=1 → stoppedReason max_cycles", async () => {
  const { engine, stateManager, project } = await approvedProject(new TraceAgent());
  const run = await engine.run(project.id, { maxCycles: 1 });
  assert(run.cycles === 1 && run.stoppedReason === "max_cycles", `expected max_cycles in 1 cycle, got ${run.stoppedReason}`);
  assert(stateManager.getProject(project.id).phase === "execution", "the phase did not advance to execution after the planning cycle");
});

// 10. Traceability: every cycle recorded with phase, action, reason and timestamp.
await t("autonomyTrace persists cycle/phases/decision/agent/attempt", async () => {
  const agent = new FailureRetryAgent();
  const { engine, stateManager, project } = await approvedProject(agent);
  await engine.run(project.id);
  const trace = stateManager.getProject(project.id).autonomyTrace ?? [];
  assert(trace.length >= 4, `insufficient traceability: ${trace.length} entries`);
  trace.forEach((entry, i) => {
    assert(entry.cycle === i + 1, `cycle ${entry.cycle} ≠ ${i + 1}`);
    assert(entry.phaseFrom && entry.phaseTo && entry.action && entry.reason && entry.at, `entry ${i} incomplete`);
  });
  const retryEntry = trace.find(e => e.action === "retry");
  assert(retryEntry?.taskId && retryEntry?.agentId && retryEntry?.attempt === 2, "the retry entry does not link task/agent/attempt");
  assert(trace[trace.length - 1].action === "complete", "the last cycle is not 'complete'");
});

// 11. Completed project → run() re-executes nothing.
await t("completed project → immediate terminal, no re-execution", async () => {
  const agent = new TraceAgent();
  const { engine, stateManager, project } = await approvedProject(agent);
  const first = await engine.run(project.id);
  assert(first.stoppedReason === "completed", `setup failed: ${first.stoppedReason}`);
  const executions = agent.receivedTasks.length;
  const second = await engine.run(project.id);
  assert(second.stoppedReason === "completed" && second.cycles === 1, "run() on completed did not finish in 1 cycle");
  assert(agent.receivedTasks.length === executions, "tasks were re-executed on a completed project");
  void stateManager;
});

console.log(`\n${ok} PASSED · ${fail} FAILED\n`);
if (fail > 0) process.exit(1);
