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
import { TraceAgent } from "./trace-agent.js";

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

const traceAgent =
  new TraceAgent();

agentRegistry.register(traceAgent);

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
      "Traceability test",
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
  "Approved for traceability testing."
);

console.log("\n=== 3. PLAN ===");

planningService.plan(
  analysis.project.id
);

console.log("\n=== 4. EXECUTE ===");

let executionCount = 0;

while (true) {
  const results =
    await scheduler.runNext(
      analysis.project.id
    );

  if (results.length === 0) {
    break;
  }

  executionCount += results.length;
}

console.log({
  executionCount
});

console.log("\n=== 5. INSPECT AGENT TASKS ===");

for (const task of traceAgent.receivedTasks) {
  const dependencyResults =
    task.inputs.dependencyResults;

  console.log({
    taskId: task.id,
    title: task.title,
    dependencyResults
  });
}

console.log("\n=== 6. VALIDATE TRACEABILITY ===");

const project =
  stateManager.getProject(
    analysis.project.id
  );

console.log("\n--- 6.1 GOVERNANCE ---");

const approvalDecision =
  project.decisions.find(
    decision =>
      decision.title ===
      "Project approval"
  );

if (!approvalDecision) {
  throw new Error(
    "TRACEABILITY FAILURE: the project approval decision does not exist."
  );
}

if (
  approvalDecision.decision !==
  "approved"
) {
  throw new Error(
    "TRACEABILITY FAILURE: the approval decision is not in state approved."
  );
}

if (!approvalDecision.rationale) {
  throw new Error(
    "TRACEABILITY FAILURE: the approval does not contain a rationale."
  );
}

if (!approvalDecision.createdAt) {
  throw new Error(
    "TRACEABILITY FAILURE: the approval does not contain createdAt."
  );
}

console.log({
  approvalDecisionId:
    approvalDecision.id,
  decision:
    approvalDecision.decision,
  rationale:
    approvalDecision.rationale,
  createdAt:
    approvalDecision.createdAt
});

console.log("\n--- 6.2 EXECUTION RESULTS ---");

const completedTasks =
  project.tasks.filter(
    task =>
      task.status ===
      "completed"
  );

const tasksWithResults =
  project.tasks.filter(
    task =>
      task.result !== undefined
  );

const tasksWithAssignedAgent =
  project.tasks.filter(
    task =>
      task.assignedAgent ===
      traceAgent.id
  );

const executionResultsOk =
  project.tasks.length === 8 &&
  completedTasks.length === 8 &&
  tasksWithResults.length === 8 &&
  tasksWithAssignedAgent.length === 8;

console.log({
  totalTasks:
    project.tasks.length,
  completedTasks:
    completedTasks.length,
  tasksWithResults:
    tasksWithResults.length,
  tasksWithAssignedAgent:
    tasksWithAssignedAgent.length,
  executionResultsOk
});

if (!executionResultsOk) {
  throw new Error(
    "TRACEABILITY FAILURE: not all tasks preserved their result and executing agent."
  );
}

const architectureTask =
  project.tasks.find(
    task =>
      task.title ===
      "Define technical architecture"
  );

const databaseTask =
  project.tasks.find(
    task =>
      task.title ===
      "Design data model"
  );

const uiuxTask =
  project.tasks.find(
    task =>
      task.title ===
      "Design experience and interface"
  );

const codingTask =
  project.tasks.find(
    task =>
      task.title ===
      "Implement solution"
  );

if (
  !architectureTask ||
  !databaseTask ||
  !uiuxTask ||
  !codingTask
) {
  throw new Error(
    "Required tasks were not found to validate traceability."
  );
}

const architectureAgentTask =
  traceAgent.receivedTasks.find(
    task =>
      task.id === architectureTask.id
  );

const codingAgentTask =
  traceAgent.receivedTasks.find(
    task =>
      task.id === codingTask.id
  );

if (!architectureAgentTask) {
  throw new Error(
    "AgentTask for architecture was not found."
  );
}

if (!codingAgentTask) {
  throw new Error(
    "AgentTask for coding was not found."
  );
}

const architectureDependencies =
  architectureAgentTask.inputs
    .dependencyResults as Array<{
      taskId: string;
      result?: unknown;
    }>;

const codingDependencies =
  codingAgentTask.inputs
    .dependencyResults as Array<{
      taskId: string;
      result?: unknown;
    }>;

const architectureDependencyIds =
  architectureDependencies.map(
    dependency =>
      dependency.taskId
  );

const codingDependencyIds =
  codingDependencies.map(
    dependency =>
      dependency.taskId
  );

const expectedArchitectureDependency =
  architectureTask.dependsOn[0];

const expectedCodingDependencies =
  [
    databaseTask.id,
    uiuxTask.id
  ];

const architectureTraceOk =
  architectureDependencyIds.length === 1 &&
  architectureDependencyIds[0] ===
    expectedArchitectureDependency &&
  architectureDependencies[0].result !== undefined;

const codingTraceOk =
  codingDependencyIds.length === 2 &&
  expectedCodingDependencies.every(
    dependencyId =>
      codingDependencyIds.includes(
        dependencyId
      )
  ) &&
  codingDependencies.every(
    dependency =>
      dependency.result !== undefined
  );

console.log({
  architectureTraceOk,
  codingTraceOk
});

if (!architectureTraceOk) {
  throw new Error(
    "TRACEABILITY FAILURE: architecture did not correctly receive its dependency's result."
  );
}

if (!codingTraceOk) {
  throw new Error(
    "TRACEABILITY FAILURE: coding did not correctly receive its dependencies' results."
  );
}

console.log(
  "\nTRACEABILITY TEST PASSED."
);

console.log({
  projectId: project.id,
  executionCount,
  tracedTasks:
    traceAgent.receivedTasks.length
});

