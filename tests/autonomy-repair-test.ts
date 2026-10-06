// Repair Engine MVP — FASE repair.
// Verifica: repair atribuible → ready → re-ejecución → re-verificación;
// maxRepairs; detección de no-progreso; trace; gate intacto.
//   npx tsx tests/autonomy-repair-test.ts
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
import { ProjectTask } from "../src/core/project-state/types.js";
import {
  TaskVerification,
  TaskVerifier
} from "../src/core/verification/contracts.js";

let ok = 0;
let fail = 0;
function t(nombre: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { ok++; console.log(`  PASS  ${nombre}`); })
    .catch((e: Error) => { fail++; console.log(`  FAIL  ${nombre}: ${e.message}`); });
}
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };

/** Falla cada tarea SOLO en la primera verificación → repair + éxito. */
class FailOncePerTaskVerifier implements TaskVerifier {
  private failed = new Set<string>();
  verifyTask(task: ProjectTask): TaskVerification {
    if (!this.failed.has(task.id)) {
      this.failed.add(task.id);
      return { taskId: task.id, passed: false, findings: ["first-check failure"] };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

/** Falla siempre las tareas de un rol; finding estable (no-progreso). */
class FailRoleVerifier implements TaskVerifier {
  constructor(private role: string, private label: (n: number) => string) {}
  private rounds = 0;
  beginRound() { this.rounds++; }
  verifyTask(task: ProjectTask): TaskVerification {
    if (task.role === this.role) {
      return { taskId: task.id, passed: false, findings: [this.label(this.rounds)] };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

function build(verifier?: TaskVerifier, maxRepairs?: number) {
  const agent = new TraceAgent();
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
    stateManager, planningService, scheduler, verificationService,
    undefined, maxRepairs
  );
  return { stateManager, strategicService, approvalGate, engine, agent };
}

async function approvedProject(sys: ReturnType<typeof build>) {
  const r = await sys.strategicService.analyze({
    projectName: "Repair Test",
    prompt: "Proyecto para probar el repair engine."
  });
  sys.approvalGate.approve(r.project.id, "aprobado en test");
  return r.project;
}

console.log("\nRepair Engine MVP — pruebas\n");

// 1+2+5+6. Verification reparable → repair → ready → re-ejecución →
// completed, con repairCount y trazabilidad correctas.
await t("verification falla reparable → repair → completed", async () => {
  const sys = build(new FailOncePerTaskVerifier());
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "completed", `esperaba completed, llegó ${run.stoppedReason}`);
  assert(run.decisions.includes("repair"), `sin decisión repair: ${run.decisions}`);
  const p = sys.stateManager.getProject(project.id);
  assert(p.metadata.repairCount === 1, `repairCount=${p.metadata.repairCount} ≠ 1`);
  assert(p.phase === "completed" && p.status === "completed", "proyecto no completó tras reparación");
  // Las 8 tareas reparadas se re-ejecutaron (2 entradas de historial).
  assert(p.tasks.every(task => task.attemptHistory.length === 2),
    "las tareas reparadas no tienen 2 intentos en attemptHistory");
  // El agente recibió el repairContext en la segunda ejecución.
  const secondExec = sys.agent.receivedTasks[8]; // primer reintento de reparación
  assert(secondExec?.inputs?.repairContext, "el agente no recibió repairContext");
  const repairTrace = (p.autonomyTrace ?? []).find(e => e.action === "repair");
  assert(repairTrace?.taskId && repairTrace.reason && repairTrace.cycle > 0 &&
    repairTrace.outcome === "repair_scheduled",
    `trace repair incorrecto: ${JSON.stringify(repairTrace)}`);
});

// 1 (foco) — durante el repair la tarea afectada vuelve a "ready".
await t("repair → la tarea afectada queda en ready", async () => {
  const verifier = new FailRoleVerifier("testing", () => "single-task finding");
  const sys = build(verifier);
  const project = await approvedProject(sys);
  // Paso a paso hasta la decisión repair; inspección intermedia.
  let step;
  do {
    verifier.beginRound();
    step = await sys.engine.step(project.id);
  } while (!step.terminal && step.decision !== "repair");
  assert(step.decision === "repair", `esperaba repair, llegó ${step.decision}`);
  const p = sys.stateManager.getProject(project.id);
  const fixed = p.tasks.find(task => task.role === "testing");
  assert(fixed?.status === "ready", `tarea reparada no quedó ready: ${fixed?.status}`);
  assert(fixed?.repairContext?.repairCycle === 1, "repairContext ausente o ciclo incorrecto");
  assert(fixed!.attemptHistory.length === 1, "attemptHistory se reseteó indebidamente");
  assert(p.phase === "execution", "la fase no regresó a execution");
  assert(p.tasks.filter(task => task.status === "ready").length === 1,
    "se reabrieron tareas no afectadas");
});

// 3. Repair sin progreso persistente con findings VARIABLES → maxRepairs.
await t("repairs agotados → maxRepairs → paused", async () => {
  // Findings distintos en cada ronda → nunca hay noProgress; agota el
  // presupuesto de reparación (maxRepairs=2).
  const verifier = new FailRoleVerifier("testing", n => `round-${n} failure`);
  const sys = build(verifier, 2);
  const project = await approvedProject(sys);
  let step;
  do {
    verifier.beginRound();
    step = await sys.engine.step(project.id);
  } while (!step.terminal);
  assert(step.decision === "block", `esperaba block, llegó ${step.decision}`);
  const p = sys.stateManager.getProject(project.id);
  assert(p.status === "paused", `proyecto no pausado: ${p.status}`);
  assert(p.metadata.repairCount === 2, `repairCount=${p.metadata.repairCount} ≠ 2`);
  const repairs = (p.autonomyTrace ?? []).filter(e => e.action === "repair");
  assert(repairs.length === 2, `esperaba 2 repairs, hubo ${repairs.length}`);
});

// 4. Findings idénticos consecutivos → noProgress → block + paused.
await t("findings idénticos → noProgress → block inmediato", async () => {
  const verifier = new FailRoleVerifier("testing", () => "always the same");
  const sys = build(verifier);
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `esperaba paused/blocked, llegó ${run.stoppedReason}`);
  const last = (sys.stateManager.getProject(project.id).autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /no progress/i.test(last.reason),
    `razón inesperada: ${last?.reason}`);
  // Solo 1 reparación: la segunda verificación idéntica bloquea.
  assert(sys.stateManager.getProject(project.id).metadata.repairCount === 1,
    "repairCount debió quedar en 1");
});

// 7. Sin aprobación el gate sigue protegiendo aunque haya repair pendiente.
await t("sin decisión approved → bloqueo aunque exista repair disponible", async () => {
  const sys = build(new FailOncePerTaskVerifier());
  const r = await sys.strategicService.analyze({
    projectName: "Gate Test",
    prompt: "Proyecto sin aprobación con fallo reparable."
  });
  // Forzar verification+running sin approve() → C3 bloquea antes de todo.
  sys.stateManager.updatePhase(r.project.id, "verification");
  sys.stateManager.updateStatus(r.project.id, "running");
  const run = await sys.engine.run(r.project.id);
  assert(run.cycles === 1, `debía bloquear en 1 ciclo, llegó ${run.cycles}`);
  const p = sys.stateManager.getProject(r.project.id);
  assert(p.status === "paused" && !run.decisions.includes("repair"),
    `se ejecutó repair sin aprobación: ${run.decisions}`);
  assert(sys.agent.receivedTasks.length === 0, "se ejecutaron tareas sin aprobación");
});

console.log(`\n${ok} PASSED · ${fail} FAILED\n`);
if (fail > 0) process.exit(1);
