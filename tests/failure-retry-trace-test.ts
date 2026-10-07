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

const stateManager = new ProjectStateManager();

const mockProvider = new MockAIProvider();
const validator = new BlueprintValidator();

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

const planner = new Planner();

const planningService =
  new PlanningService(
    stateManager,
    planner
  );

const agentRegistry =
  new AgentRegistry();

const failureAgent =
  new FailureRetryAgent();

agentRegistry.register(failureAgent);

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
      "Failure and retry test",
    prompt:
      "Build a platform to manage clients, policies, renewals, claims and documents."
  });

console.log({
  projectId: analysis.project.id,
  phase: analysis.project.phase,
  status: analysis.project.status
});

console.log("\n=== 2. APPROVE ===");

approvalGate.approve(
  analysis.project.id,
  "Approved for controlled failure-and-retry testing."
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
      taskId: result.taskId,
      success: result.success,
      agentId: result.agentId
    }))
  });

const afterFirstExecution =
  stateManager.getProject(
    analysis.project.id
  );

const firstFailedTasks =
  afterFirstExecution.tasks.filter(
    task =>
      task.status === "failed"
  );

console.log({
  failedTasks:
    firstFailedTasks.length,
  attempts:
    firstFailedTasks.map(task => ({
      taskId: task.id,
      title: task.title,
      status: task.status,
      attempts: task.attempts,
      assignedAgent: task.assignedAgent,
      hasResult:
        task.result !== undefined
    }))
});

console.log("\n=== 5. VALIDATE TRACEABLE FAILURE ===");

if (firstFailedTasks.length !== 1) {
  throw new Error(
    `Exactly one failed task was expected in the first execution. Result: ${firstFailedTasks.length}`
  );
}

const failedTask =
  firstFailedTasks[0];

if (failedTask.status !== "failed") {
  throw new Error(
    "FAILURE: the task did not end in failed status."
  );
}

if (failedTask.attempts !== 1) {
  throw new Error(
    `FAILURE: expected attempts=1 after the first failure. Actual: ${failedTask.attempts}`
  );
}

if (failedTask.assignedAgent !== failureAgent.id) {
  throw new Error(
    "FAILURE: the task does not preserve the agent that produced the failure."
  );
}

if (!failedTask.result) {
  throw new Error(
    "FAILURE: the failure AgentResult was not persisted."
  );
}

if (failedTask.result.success !== false) {
  throw new Error(
    "FAILURE: the persisted result does not preserve success=false."
  );
}

console.log({
  failedTaskId:
    failedTask.id,
  status:
    failedTask.status,
  attempts:
    failedTask.attempts,
  assignedAgent:
    failedTask.assignedAgent,
  resultSuccess:
    failedTask.result.success,
  summary:
    failedTask.result.summary
});

console.log("\n=== 6. SECOND EXECUTION ===");

const secondResults =
  await scheduler.runNext(
    analysis.project.id
  );

console.log({
  executionCount:
    secondResults.length,
  agentExecutions:
    failureAgent.receivedTasks.length
});

console.log("\n=== 7. VALIDATE CURRENT BEHAVIOR ===");

const afterSecondExecution =
  stateManager.getProject(
    analysis.project.id
  );

const finalFailedTask =
  afterSecondExecution.tasks.find(
    task =>
      task.id === failedTask.id
  );

if (!finalFailedTask) {
  throw new Error(
    "FAILURE: the task disappeared from the project state."
  );
}

console.log({
  taskId:
    finalFailedTask.id,
  status:
    finalFailedTask.status,
  attempts:
    finalFailedTask.attempts,
  agentExecutions:
    failureAgent.receivedTasks.length
});

if (finalFailedTask.status !== "failed") {
  throw new Error(
    "FAILURE: the task status changed unexpectedly after the second scheduler.runNext()."
  );
}

if (finalFailedTask.attempts !== 1) {
  throw new Error(
    "FAILURE: attempts changed unexpectedly without running a retry."
  );
}

if (failureAgent.receivedTasks.length !== 1) {
  throw new Error(
    "FAILURE: the scheduler re-ran a failed task without an explicit retry mechanism."
  );
}

if (secondResults.length !== 0) {
  throw new Error(
    "FAILURE: the scheduler was expected not to automatically select a task in failed status."
  );
}

console.log(
  "\nFAILURE TRACE TEST PASSED."
);

console.log({
  projectId:
    afterSecondExecution.id,
  firstExecutionCount:
    firstResults.length,
  secondExecutionCount:
    secondResults.length,
  failedTaskId:
    finalFailedTask.id,
  finalStatus:
    finalFailedTask.status,
  attempts:
    finalFailedTask.attempts,
  agentExecutions:
    failureAgent.receivedTasks.length
});
