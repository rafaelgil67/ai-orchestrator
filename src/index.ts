/**
 * AI Software Factory — public demo entry point.
 *
 * Wires the real orchestration stack with mock components and runs the
 * full autonomous loop end-to-end:
 *
 *   ANALYZE → APPROVE → PLAN → EXECUTE → VERIFY → REPAIR|REPLAN → …
 *
 * Everything runs in memory with MockAIProvider + MockAgent — no
 * external providers, credentials or side effects. Real agents are
 * future adapters behind the Agent / AIProvider contracts.
 */
import { ProjectStateManager } from "./core/project-state/manager.js";
import { StrategicAnalysisService } from "./core/strategy/service.js";
import { StrategicBrainEngine } from "./core/strategy/engine.js";
import { BlueprintValidator } from "./core/strategy/validator.js";
import { ProjectApprovalGate } from "./core/governance/project-approval-gate.js";
import { PlanningService } from "./core/planning/planning-service.js";
import { Planner } from "./core/planning/planner.js";
import { AgentRegistry } from "./agents/providers/agent-registry.js";
import { MockAIProvider } from "./agents/providers/mock-provider.js";
import { MockAgent } from "./agents/providers/mock-agent.js";
import { DefaultExecutionEngine } from "./core/execution/executor.js";
import { DefaultExecutionScheduler } from "./core/execution/scheduler.js";
import { VerificationService } from "./core/verification/verification-service.js";
import { AutonomyLoopEngine } from "./core/autonomy/autonomy-engine.js";

// ---- Composition root: every component is swappable via contracts ----
const stateManager = new ProjectStateManager();
const strategicService = new StrategicAnalysisService(
  stateManager,
  new StrategicBrainEngine(new MockAIProvider(), new BlueprintValidator())
);
const approvalGate = new ProjectApprovalGate(stateManager);
const planningService = new PlanningService(stateManager, new Planner());
const agentRegistry = new AgentRegistry();
agentRegistry.register(new MockAgent());
const scheduler = new DefaultExecutionScheduler(
  stateManager,
  new DefaultExecutionEngine(stateManager, agentRegistry)
);
const verificationService = new VerificationService(stateManager);
const engine = new AutonomyLoopEngine(
  stateManager,
  planningService,
  scheduler,
  verificationService
);

// ---- 1. ANALYZE: brief → strategic blueprint → approval phase ----
const brief = {
  projectName: "Demo Project",
  prompt:
    "Build a small task-management web app with user auth, a REST API " +
    "and automated tests."
};
console.log(`\n== AI Software Factory demo ==`);
console.log(`Brief: ${brief.projectName}\n`);
console.log("[1] ANALYZE — generating strategic blueprint…");
const { project } = await strategicService.analyze(brief);
console.log(`    project ${project.id} → ${project.phase}/${project.status}`);

// ---- 2. APPROVE: the human gate — explicit, never automatic ----
console.log("[2] APPROVE — human approval recorded via Approval Gate");
approvalGate.approve(project.id, "demo run — approved by operator");

// ---- 3. RUN: the autonomy loop drives the rest ----
console.log("[3] RUN — autonomy loop (plan → execute → verify → recover)\n");
const run = await engine.run(project.id, { maxCycles: 50 });

const final = stateManager.getProject(project.id);
console.log(`Result: ${run.stoppedReason} in ${run.cycles} cycle(s)`);
console.log(`Final: ${final.phase}/${final.status} — ` +
  `${final.tasks.filter(t => t.status === "completed").length}/` +
  `${final.tasks.length} tasks completed`);

if (final.metadata.repairCount || final.metadata.replanCount) {
  console.log(`Recovery: repairs=${final.metadata.repairCount ?? 0} ` +
    `replans=${final.metadata.replanCount ?? 0}`);
}

console.log(`\nAutonomy trace (${final.autonomyTrace?.length ?? 0} entries):`);
for (const e of final.autonomyTrace ?? []) {
  const task = e.taskId ? ` task=${e.taskId.slice(0, 12)}…` : "";
  console.log(
    `  [${String(e.cycle).padStart(2)}] ${e.phaseFrom} → ${e.phaseTo} ` +
    `| ${e.action} | ${e.outcome}${task}`
  );
}
console.log();
