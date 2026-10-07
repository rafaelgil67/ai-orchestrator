import { ProjectStateManager } from "../src/core/project-state/manager.js";
import { StrategicAnalysisService } from "../src/core/strategy/service.js";
import { StrategicBrainEngine } from "../src/core/strategy/engine.js";
import { BlueprintValidator } from "../src/core/strategy/validator.js";
import { ProjectApprovalGate } from "../src/core/governance/project-approval-gate.js";
import { PlanningService } from "../src/core/planning/planning-service.js";
import { Planner } from "../src/core/planning/planner.js";
import { AgentRegistry } from "../src/agents/providers/agent-registry.js";
import { DefaultExecutionEngine } from "../src/core/execution/executor.js";
import { DefaultExecutionScheduler } from "../src/core/execution/scheduler.js";
import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
import { FailureRetryAgent } from "./failure-retry-agent.js";

const stateManager =
  new ProjectStateManager();

const mockProvider =
  new MockAIProvider();

const validator =
  new BlueprintValidator();

const strategicBrain =
  new StrategicBrainEngine(
    mockProvider,
    validator
  );

const strategicService =
  new StrategicAnalysisService(
    stateManager,
    strategicBrain
  );

const approvalGate =
  new ProjectApprovalGate(
    stateManager
  );

const planner =
  new Planner();

const planningService =
  new PlanningService(
    stateManager,
    planner
  );

const agentRegistry =
  new AgentRegistry();

const failureAgent =
  new FailureRetryAgent();

agentRegistry.register(
  failureAgent
);

const executionEngine =
  new DefaultExecutionEngine(
    stateManager,
    agentRegistry
  );

const scheduler =
  new DefaultExecutionScheduler(
    stateManager,
    executionEngine
  );

console.log("\n=== 1. CREATE PROJECT ===");

const analysis =
  await strategicService.analyze({
    projectName:
      "Explicit retry test",
    prompt:
      "Build a platform to manage clients, policies, renewals, claims and documents."
  });

console.log({
  projectId:
    analysis.project.id,
  phase:
    analysis.project.phase,
  status:
    analysis.project.status
});

console.log("\n=== 2. APPROVE ===");

approvalGate.approve(
  analysis.project.id,
  "Approved for controlled explicit-retry testing."
);

console.log("\n=== 3. PLAN ===");

planningService.plan(
  analysis.project.id
);

const plannedProject =
  stateManager.getProject(
    analysis.project.id
  );

console.log({
  taskCount:
    plannedProject.tasks.length,
  phase:
    plannedProject.phase,
  status:
    plannedProject.status
});

console.log("\n=== 4. FIRST EXECUTION ===");

const firstResults =
  await scheduler.runNext(
    analysis.project.id
  );

console.log({
  executionCount:
    firstResults.length,
  results:
    firstResults.map(result => ({
      taskId:
        result.taskId,
      success:
        result.success,
      attempt:
        result.attempt,
      retry:
        result.retry,
      agentId:
        result.agentId
    }))
  });

const afterFirst =
  stateManager.getProject(
    analysis.project.id
  );

const failedTask =
  afterFirst.tasks.find(
    task =>
      task.status === "failed"
  );

if (!failedTask) {
  throw new Error(
    "FAILURE: no failed task was found after the first execution."
  );
}

console.log({
  failedTaskId:
    failedTask.id,
  status:
    failedTask.status,
  attempts:
    failedTask.attempts,
  retryCount:
    failedTask.retryCount,
  attemptHistoryLength:
    failedTask.attemptHistory.length
});

if (failedTask.attempts !== 1) {
  throw new Error(
    `FAILURE: expected attempts=1. Actual: ${failedTask.attempts}`
  );
}

if (failedTask.retryCount !== 0) {
  throw new Error(
    `FAILURE: expected retryCount=0 before the retry. Actual: ${failedTask.retryCount}`
  );
}

if (
  failedTask.attemptHistory.length !== 1
) {
  throw new Error(
    "FAILURE: expected exactly one entry in attemptHistory."
  );
}

console.log("\n=== 5. EXPLICIT RETRY ===");

const retryResult =
  await scheduler.retryTask(
    analysis.project.id,
    failedTask.id
  );

console.log({
  taskId:
    retryResult.taskId,
  success:
    retryResult.success,
  attempt:
    retryResult.attempt,
  retry:
    retryResult.retry,
  agentId:
    retryResult.agentId
});

if (!retryResult.success) {
  throw new Error(
    "FAILURE: the explicit retry did not complete successfully."
  );
}

if (retryResult.attempt !== 2) {
  throw new Error(
    `FAILURE: expected attempt=2. Actual: ${retryResult.attempt}`
  );
}

if (retryResult.retry !== true) {
  throw new Error(
    "FAILURE: the retry result is not marked as retry=true."
  );
}

console.log("\n=== 6. VALIDATE FINAL STATE ===");

const finalProject =
  stateManager.getProject(
    analysis.project.id
  );

const finalTask =
  finalProject.tasks.find(
    task =>
      task.id === failedTask.id
  );

if (!finalTask) {
  throw new Error(
    "FAILURE: the task disappeared after the retry."
  );
}

console.log({
  taskId:
    finalTask.id,
  status:
    finalTask.status,
  attempts:
    finalTask.attempts,
  retryCount:
    finalTask.retryCount,
  attemptHistoryLength:
    finalTask.attemptHistory.length,
  agentExecutions:
    failureAgent.receivedTasks.length
});

if (finalTask.status !== "completed") {
  throw new Error(
    `FAILURE: expected status=completed. Actual: ${finalTask.status}`
  );
}

if (finalTask.attempts !== 2) {
  throw new Error(
    `FAILURE: expected 2 attempts. Actual: ${finalTask.attempts}`
  );
}

if (finalTask.retryCount !== 1) {
  throw new Error(
    `FAILURE: expected retryCount=1. Actual: ${finalTask.retryCount}`
  );
}

if (
  finalTask.attemptHistory.length !== 2
) {
  throw new Error(
    `FAILURE: expected 2 attempt records. Actual: ${finalTask.attemptHistory.length}`
  );
}

if (
  finalTask.attemptHistory[0].success !== false
) {
  throw new Error(
    "FAILURE: the first attempt was not recorded as failed."
  );
}

if (
  finalTask.attemptHistory[0].retry !== false
) {
  throw new Error(
    "FAILURE: the first attempt was not marked as retry=false."
  );
}

if (
  finalTask.attemptHistory[1].success !== true
) {
  throw new Error(
    "FAILURE: the second attempt was not recorded as successful."
  );
}

if (
  finalTask.attemptHistory[1].retry !== true
) {
  throw new Error(
    "FAILURE: the second attempt was not marked as retry=true."
  );
}

if (
  failureAgent.receivedTasks.length !== 2
) {
  throw new Error(
    `FAILURE: expected exactly 2 agent executions. Actual: ${failureAgent.receivedTasks.length}`
  );
}

console.log(
  "\nEXPLICIT RETRY TEST PASSED."
);

console.log({
  projectId:
    finalProject.id,
  taskId:
    finalTask.id,
  firstAttempt:
    finalTask.attemptHistory[0],
  secondAttempt:
    finalTask.attemptHistory[1],
  finalStatus:
    finalTask.status,
  attempts:
    finalTask.attempts,
  retryCount:
    finalTask.retryCount,
  agentExecutions:
    failureAgent.receivedTasks.length
});
