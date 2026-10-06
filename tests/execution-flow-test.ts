import { ProjectStateManager } from "../src/core/project-state/manager.js";
import { StrategicAnalysisService } from "../src/core/strategy/service.js";
import { StrategicBrainEngine } from "../src/core/strategy/engine.js";
import { BlueprintValidator } from "../src/core/strategy/validator.js";
import { ProjectApprovalGate } from "../src/core/governance/project-approval-gate.js";
import { PlanningService } from "../src/core/planning/planning-service.js";
import { Planner } from "../src/core/planning/planner.js";
import { AgentRegistry } from "../src/agents/providers/agent-registry.js";
import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
import { MockAgent } from "../src/agents/providers/mock-agent.js";
import { DefaultExecutionEngine } from "../src/core/execution/executor.js";
import { DefaultExecutionScheduler } from "../src/core/execution/scheduler.js";

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

const mockAgent = new MockAgent();

agentRegistry.register(mockAgent);

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

console.log("\n=== 1. DIAGNÓSTICO ===");

const analysis =
  await strategicService.analyze({
    projectName:
      "Plataforma de gestión de seguros",
    prompt:
      "Crear una plataforma para administrar clientes, pólizas, renovaciones, siniestros y documentos."
  });

console.log({
  projectId: analysis.project.id,
  phase: analysis.project.phase,
  status: analysis.project.status
});

console.log("\n=== 2. APROBACIÓN ===");

const approval =
  approvalGate.approve(
    analysis.project.id,
    "Diagnóstico aprobado para ejecución."
  );

console.log({
  approved: approval.approved,
  phase: approval.project.phase,
  status: approval.project.status
});

console.log("\n=== 3. PLANIFICACIÓN ===");

const plan =
  planningService.plan(
    analysis.project.id
  );

console.log({
  phase: plan.project.phase,
  status: plan.project.status,
  taskCount: plan.planning.tasks.length,
  executionOrder:
    plan.planning.executionOrder
});

console.log("\n=== 4. TAREAS ===");

for (const task of plan.project.tasks) {
  console.log({
    id: task.id,
    title: task.title,
    role: task.role,
    status: task.status,
    dependsOn: task.dependsOn
  });
}

console.log("\n=== 5. EJECUCIÓN ===");

const executionResults = [];

while (true) {
  const results =
    await scheduler.runNext(
      analysis.project.id
    );

  if (results.length === 0) {
    break;
  }

  executionResults.push(...results);
}

const finalProject =
  stateManager.getProject(
    analysis.project.id
  );

console.log({
  projectId: finalProject.id,
  phase: finalProject.phase,
  status: finalProject.status,
  executionCount: executionResults.length
});

console.log("\n=== 6. RESULTADOS ===");

for (const task of finalProject.tasks) {
  console.log({
    id: task.id,
    title: task.title,
    role: task.role,
    status: task.status,
    assignedAgent:
      task.assignedAgent,
    attempts:
      task.attempts
  });
}





