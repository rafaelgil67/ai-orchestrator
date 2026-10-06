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

console.log("\n=== 1. CREAR PROYECTO ===");

const analysis =
  await strategicService.analyze({
    projectName:
      "Prueba de fallo y reintento",
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
  "Aprobado para prueba controlada de fallo y reintento."
);

console.log("\n=== 3. PLANIFICAR ===");

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

console.log("\n=== 4. PRIMERA EJECUCIÓN ===");

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

console.log("\n=== 5. VALIDAR FALLO TRAZABLE ===");

if (firstFailedTasks.length !== 1) {
  throw new Error(
    `Se esperaba exactamente una tarea fallida en la primera ejecución. Resultado: ${firstFailedTasks.length}`
  );
}

const failedTask =
  firstFailedTasks[0];

if (failedTask.status !== "failed") {
  throw new Error(
    "FALLO: la tarea no quedó en estado failed."
  );
}

if (failedTask.attempts !== 1) {
  throw new Error(
    `FALLO: se esperaba attempts=1 después del primer fallo. Actual: ${failedTask.attempts}`
  );
}

if (failedTask.assignedAgent !== failureAgent.id) {
  throw new Error(
    "FALLO: la tarea no conserva el agente que produjo el fallo."
  );
}

if (!failedTask.result) {
  throw new Error(
    "FALLO: el AgentResult del fallo no fue persistido."
  );
}

if (failedTask.result.success !== false) {
  throw new Error(
    "FALLO: el resultado persistido no conserva success=false."
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

console.log("\n=== 6. SEGUNDA EJECUCIÓN ===");

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

console.log("\n=== 7. VALIDAR COMPORTAMIENTO ACTUAL ===");

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
    "FALLO: la tarea desapareció del estado del proyecto."
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
    "FALLO: el estado de la tarea cambió inesperadamente después del segundo scheduler.runNext()."
  );
}

if (finalFailedTask.attempts !== 1) {
  throw new Error(
    "FALLO: attempts cambió inesperadamente sin ejecutar un reintento."
  );
}

if (failureAgent.receivedTasks.length !== 1) {
  throw new Error(
    "FALLO: el scheduler ejecutó nuevamente una tarea fallida sin existir mecanismo explícito de retry."
  );
}

if (secondResults.length !== 0) {
  throw new Error(
    "FALLO: se esperaba que el scheduler no seleccionara automáticamente una tarea en estado failed."
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
