// Autonomy Loop Engine — FASE loop MVP.
// Cubre: gate nunca salteado, transiciones válidas, retry con límite,
// dependencias, verificación antes de completar, maxCycles, trazabilidad.
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

// Agente que falla siempre — para probar el agotamiento de maxRetries.
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
      summary: `Fallo permanente en "${task.title}".`,
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
    prompt: "Construir una app de prueba para el loop autónomo."
  });
  return r.project;
}

async function approvedProject(agent: Agent, verifier?: TaskVerifier) {
  const sys = build(agent, verifier);
  const project = await analyzedProject(sys.strategicService);
  sys.approvalGate.approve(project.id, "aprobado en test");
  return { ...sys, project };
}

console.log("\nAutonomy Loop Engine — pruebas\n");

// 1. Proyecto no aprobado → el loop se detiene limpiamente, nada ejecuta.
await t("proyecto no aprobado → wait limpio, sin ejecución", async () => {
  const sys = build(new TraceAgent());
  const project = await analyzedProject(sys.strategicService);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "awaiting_approval", `esperaba awaiting_approval, llegó ${run.stoppedReason}`);
  assert(run.cycles === 1, `esperaba 1 ciclo, llegó ${run.cycles}`);
  const p = sys.stateManager.getProject(project.id);
  assert(p.phase === "approval" && p.status === "awaiting_approval", "el loop alteró el estado de aprobación");
  assert(p.tasks.length === 0, "se planificaron tareas sin aprobación");
});

// 2+3. Aprobado → planea, ejecuta, verifica, completa; decisiones correctas.
await t("aprobado → ANALYZE→APPROVE→PLAN→EXECUTE→VERIFY→COMPLETE", async () => {
  const { engine, stateManager, project } = await approvedProject(new TraceAgent());
  const run = await engine.run(project.id);
  assert(run.stoppedReason === "completed", `esperaba completed, llegó ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.phase === "completed" && p.status === "completed", `fase final incorrecta: ${p.phase}/${p.status}`);
  assert(p.tasks.every(task => task.status === "completed"), "hay tareas sin completar");
  assert(run.decisions.every(d => d !== "retry" && d !== "fail"), `decisiones inesperadas: ${run.decisions}`);
});

// 4. Fallo → retry explícito, la tarea acaba completada.
await t("fallo de tarea → retry hasta éxito", async () => {
  const failAgent = new FailureRetryAgent(); // falla la 1ª, éxito la 2ª
  const { engine, stateManager, project } = await approvedProject(failAgent);
  const run = await engine.run(project.id);
  assert(run.stoppedReason === "completed", `esperaba completed, llegó ${run.stoppedReason}`);
  assert(run.decisions.includes("retry"), `no hubo decisión retry: ${run.decisions}`);
  const retried = stateManager.getProject(project.id).tasks.find(task => task.retryCount > 0);
  assert(retried && retried.status === "completed" && retried.retryCount === 1, "el retry no quedó correctamente registrado");
  assert(failAgent.receivedTasks.length === 8 + 1, `esperaba 9 ejecuciones (8 tareas + 1 retry), hubo ${failAgent.receivedTasks.length}`);
});

// 5. Retry agotado → blocked + paused, sin loop infinito.
await t("retry agotado → tarea blocked, proyecto paused (sin loop infinito)", async () => {
  const agent = new AlwaysFailAgent();
  const { engine, stateManager, project } = await approvedProject(agent);
  const run = await engine.run(project.id, { maxCycles: 50 });
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked", `esperaba paused/blocked, llegó ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `proyecto no quedó paused: ${p.status}`);
  const task = p.tasks.find(x => x.status === "blocked");
  assert(task, "ninguna tarea quedó blocked");
  assert(task!.retryCount === task!.maxRetries, `retryCount=${task!.retryCount} ≠ maxRetries=${task!.maxRetries}`);
  assert(task!.attempts === 1 + task!.maxRetries, `attempts=${task!.attempts} ≠ 1+maxRetries`);
  assert(agent.executions === 1 + task!.maxRetries, `el agente se ejecutó ${agent.executions} veces, esperaba ${1 + task!.maxRetries}`);
  assert(run.cycles <= 10, `demasiados ciclos: ${run.cycles}`);
});

// 6. Dependencias respetadas dentro del loop.
await t("dependencias respetadas durante el loop", async () => {
  const agent = new TraceAgent();
  const { engine, stateManager, project } = await approvedProject(agent);
  await engine.run(project.id);
  const p = stateManager.getProject(project.id);
  const order = agent.receivedTasks.map(task => task.id);
  for (const task of p.tasks) {
    for (const dep of task.dependsOn) {
      assert(order.indexOf(dep) !== -1 && order.indexOf(dep) < order.indexOf(task.id),
        `tarea ${task.id} ejecutó antes de su dependencia ${dep}`);
    }
  }
});

// 7+8. Verificación fallida → repair (MVP) → sin progreso → paused,
// nunca completed; verificación OK → completed.
await t("verificación fallida → repair sin progreso → paused, nunca completed", async () => {
  const { engine, stateManager, project } = await approvedProject(new TraceAgent(), new FailVerifier());
  const run = await engine.run(project.id);
  // Repair MVP: findings atribuibles → repair → misma signature →
  // noProgress → block + paused. Ya NO termina en failed directo.
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `esperaba paused/blocked, llegó ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused" && p.phase !== "completed",
    `estado final incorrecto: ${p.phase}/${p.status}`);
  assert(run.decisions.includes("repair"), `no hubo decisión repair: ${run.decisions}`);
});

// 9. maxCycles acota el loop.
await t("run con maxCycles=1 → stoppedReason max_cycles", async () => {
  const { engine, stateManager, project } = await approvedProject(new TraceAgent());
  const run = await engine.run(project.id, { maxCycles: 1 });
  assert(run.cycles === 1 && run.stoppedReason === "max_cycles", `esperaba max_cycles en 1 ciclo, llegó ${run.stoppedReason}`);
  assert(stateManager.getProject(project.id).phase === "execution", "la fase no avanzó a execution tras el ciclo de planning");
});

// 10. Trazabilidad: cada ciclo registrado con fase, acción, razón y timestamp.
await t("autonomyTrace persiste ciclo/fases/decisión/agente/intento", async () => {
  const agent = new FailureRetryAgent();
  const { engine, stateManager, project } = await approvedProject(agent);
  await engine.run(project.id);
  const trace = stateManager.getProject(project.id).autonomyTrace ?? [];
  assert(trace.length >= 4, `trazabilidad insuficiente: ${trace.length} entradas`);
  trace.forEach((entry, i) => {
    assert(entry.cycle === i + 1, `cycle ${entry.cycle} ≠ ${i + 1}`);
    assert(entry.phaseFrom && entry.phaseTo && entry.action && entry.reason && entry.at, `entrada ${i} incompleta`);
  });
  const retryEntry = trace.find(e => e.action === "retry");
  assert(retryEntry?.taskId && retryEntry?.agentId && retryEntry?.attempt === 2, "la entrada retry no enlaza tarea/agente/intento");
  assert(trace[trace.length - 1].action === "complete", "el último ciclo no es 'complete'");
});

// 11. Proyecto completado → run() no re-ejecuta nada.
await t("proyecto completed → terminal inmediato, sin re-ejecución", async () => {
  const agent = new TraceAgent();
  const { engine, stateManager, project } = await approvedProject(agent);
  const first = await engine.run(project.id);
  assert(first.stoppedReason === "completed", `setup falló: ${first.stoppedReason}`);
  const executions = agent.receivedTasks.length;
  const second = await engine.run(project.id);
  assert(second.stoppedReason === "completed" && second.cycles === 1, "run() sobre completado no terminó en 1 ciclo");
  assert(agent.receivedTasks.length === executions, "se re-ejecutaron tareas en un proyecto completado");
  void stateManager;
});

console.log(`\n${ok} PASSED · ${fail} FAILED\n`);
if (fail > 0) process.exit(1);
