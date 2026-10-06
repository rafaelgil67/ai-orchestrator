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

console.log("\n=== 1. CREAR PROYECTO ===");

const analysis =
  await strategicService.analyze({
    projectName:
      "Prueba de trazabilidad",
    prompt:
      "Crear una plataforma para administrar clientes, pólizas, renovaciones, siniestros y documentos."
  });

console.log({
  projectId: analysis.project.id,
  phase: analysis.project.phase,
  status: analysis.project.status
});

console.log("\n=== 2. APROBAR ===");

approvalGate.approve(
  analysis.project.id,
  "Aprobado para prueba de trazabilidad."
);

console.log("\n=== 3. PLANIFICAR ===");

planningService.plan(
  analysis.project.id
);

console.log("\n=== 4. EJECUTAR ===");

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

console.log("\n=== 5. INSPECCIONAR AGENT TASKS ===");

for (const task of traceAgent.receivedTasks) {
  const dependencyResults =
    task.inputs.dependencyResults;

  console.log({
    taskId: task.id,
    title: task.title,
    dependencyResults
  });
}

console.log("\n=== 6. VALIDAR TRAZABILIDAD ===");

const project =
  stateManager.getProject(
    analysis.project.id
  );

console.log("\n--- 6.1 GOBERNANZA ---");

const approvalDecision =
  project.decisions.find(
    decision =>
      decision.title ===
      "Aprobación del proyecto"
  );

if (!approvalDecision) {
  throw new Error(
    "FALLO DE TRAZABILIDAD: no existe la decisión de aprobación del proyecto."
  );
}

if (
  approvalDecision.decision !==
  "approved"
) {
  throw new Error(
    "FALLO DE TRAZABILIDAD: la decisión de aprobación no tiene estado approved."
  );
}

if (!approvalDecision.rationale) {
  throw new Error(
    "FALLO DE TRAZABILIDAD: la aprobación no contiene rationale."
  );
}

if (!approvalDecision.createdAt) {
  throw new Error(
    "FALLO DE TRAZABILIDAD: la aprobación no contiene createdAt."
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

console.log("\n--- 6.2 RESULTADOS DE EJECUCIÓN ---");

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
    "FALLO DE TRAZABILIDAD: no todas las tareas conservaron su resultado y agente ejecutor."
  );
}

const architectureTask =
  project.tasks.find(
    task =>
      task.title ===
      "Definir arquitectura técnica"
  );

const databaseTask =
  project.tasks.find(
    task =>
      task.title ===
      "Diseñar modelo de datos"
  );

const uiuxTask =
  project.tasks.find(
    task =>
      task.title ===
      "Diseñar experiencia e interfaz"
  );

const codingTask =
  project.tasks.find(
    task =>
      task.title ===
      "Implementar solución"
  );

if (
  !architectureTask ||
  !databaseTask ||
  !uiuxTask ||
  !codingTask
) {
  throw new Error(
    "No se encontraron las tareas necesarias para validar trazabilidad."
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
    "No se encontró AgentTask para arquitectura."
  );
}

if (!codingAgentTask) {
  throw new Error(
    "No se encontró AgentTask para coding."
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
    "FALLO DE TRAZABILIDAD: arquitectura no recibió correctamente el resultado de su dependencia."
  );
}

if (!codingTraceOk) {
  throw new Error(
    "FALLO DE TRAZABILIDAD: coding no recibió correctamente los resultados de sus dependencias."
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

