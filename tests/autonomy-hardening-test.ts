// Autonomy Loop Hardening — correcciones C1/C2/C3 del diagnóstico.
//   C1: excepciones contenidas, trazadas y terminales (plan/verify/etc.)
//   C2: ejecución sin trabajo → block inmediato, nunca maxCycles
//   C3: planning/execution/verification exigen decisión "approved"
//   npx tsx tests/autonomy-hardening-test.ts
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
import { Agent } from "../src/agents/contracts/agent.js";
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

class ExplodingVerifier implements TaskVerifier {
  verifyTask(): never {
    throw new Error("verifier exploded");
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
    projectName: "Hardening Test",
    prompt: "Proyecto para probar el hardening del loop."
  });
  return r.project;
}

console.log("\nAutonomy Loop — hardening (C1/C2/C3)\n");

// C1a — excepción durante planning: contenida, trazada, proyecto pausado.
await t("C1: excepción en plan() → block trazado + paused (no crash)", async () => {
  const agent = new TraceAgent();
  const { stateManager, strategicService, approvalGate, engine } = build(agent);
  const project = await analyzedProject(strategicService);
  approvalGate.approve(project.id);
  // Blueprint eliminado tras aprobación → plan() lanza.
  stateManager.setMetadata(project.id, "strategicBlueprint", undefined);
  const run = await engine.run(project.id);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `esperaba paused/blocked, llegó ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `proyecto no pausado: ${p.status}`);
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && last.outcome === "error",
    `trace final incorrecto: ${JSON.stringify(last)}`);
  assert(/blueprint/i.test(last!.reason), "la razón no conserva el mensaje del error");
  assert(agent.receivedTasks.length === 0, "se ejecutaron tareas tras el error");
});

// C1b — TaskVerifier que lanza → contenido, trazado, terminal.
await t("C1: TaskVerifier que lanza → block trazado + paused", async () => {
  const agent = new TraceAgent();
  const { stateManager, engine, approvalGate, strategicService } =
    build(agent, new ExplodingVerifier());
  const project = await analyzedProject(strategicService);
  approvalGate.approve(project.id);
  const run = await engine.run(project.id);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `esperaba paused/blocked, llegó ${run.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `proyecto no pausado: ${p.status}`);
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && last.outcome === "error" &&
    last.phaseFrom === "verification",
    `trace final incorrecto: ${JSON.stringify(last)}`);
  // El siguiente run() no repite la operación fallida.
  const run2 = await engine.run(project.id);
  assert(run2.cycles === 1 && run2.stoppedReason === "paused",
    "run() sobre proyecto pausado no terminó en 1 ciclo");
});

// C2 — execution+running sin tareas → block inmediato, no max_cycles.
await t("C2: ejecución sin tareas → block inmediato", async () => {
  const agent = new TraceAgent();
  const { stateManager, strategicService, approvalGate, engine } = build(agent);
  const project = await analyzedProject(strategicService);
  approvalGate.approve(project.id);
  // Forzar execution vacío (simula plan vacío): sin pasar por plan().
  stateManager.updatePhase(project.id, "execution");
  const run = await engine.run(project.id, { maxCycles: 50 });
  assert(run.cycles === 1, `debía bloquear en 1 ciclo, llegó ${run.cycles}`);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `esperaba paused/blocked, llegó ${run.stoppedReason}`);
  assert(stateManager.getProject(project.id).status === "paused",
    "proyecto no quedó paused");
  const last = (stateManager.getProject(project.id).autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /no work|deadlock/i.test(last.reason),
    `razón inesperada: ${last?.reason}`);
});

// C3 — planning+running forzado sin aprobación → bloqueado, nada ejecuta.
await t("C3: planning+running sin decisión approved → bloqueo", async () => {
  const agent = new TraceAgent();
  const { stateManager, strategicService, engine } = build(agent);
  const project = await analyzedProject(strategicService);
  // Bypass directo del gate: nadie llamó approve().
  stateManager.updatePhase(project.id, "planning");
  stateManager.updateStatus(project.id, "running");
  const run = await engine.run(project.id);
  assert(run.cycles === 1, `debía bloquear en 1 ciclo, llegó ${run.cycles}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `proyecto no pausado: ${p.status}`);
  assert(p.tasks.length === 0, "se planificaron tareas sin aprobación");
  assert(agent.receivedTasks.length === 0, "se ejecutaron tareas sin aprobación");
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /approval/i.test(last.reason),
    `razón inesperada: ${last?.reason}`);
});

// C3b — execution forzado sin aprobación → igualmente bloqueado.
await t("C3: execution+running sin decisión approved → bloqueo", async () => {
  const agent = new TraceAgent();
  const { stateManager, strategicService, engine } = build(agent);
  const project = await analyzedProject(strategicService);
  stateManager.updatePhase(project.id, "execution");
  stateManager.updateStatus(project.id, "running");
  const run = await engine.run(project.id);
  assert(run.cycles === 1, `debía bloquear en 1 ciclo, llegó ${run.cycles}`);
  assert(agent.receivedTasks.length === 0, "se ejecutaron tareas sin aprobación");
  assert(stateManager.getProject(project.id).status === "paused", "proyecto no pausado");
});

// Extra — equivalencia run() ≈ N×step(): mismas decisiones, mismo estado.
await t("run() ≡ secuencia de step()", async () => {
  const a1 = new TraceAgent();
  const s1 = build(a1);
  const p1 = await analyzedProject(s1.strategicService);
  s1.approvalGate.approve(p1.id);
  const run = await s1.engine.run(p1.id);

  const a2 = new TraceAgent();
  const s2 = build(a2);
  const p2 = await analyzedProject(s2.strategicService);
  s2.approvalGate.approve(p2.id);
  const decisions = [];
  let step;
  do {
    step = await s2.engine.step(p2.id);
    decisions.push(step.decision);
  } while (!step.terminal);

  assert(run.stoppedReason === "completed", `run() no completó: ${run.stoppedReason}`);
  assert(run.decisions.join() === decisions.join(),
    `decisiones difieren: ${run.decisions} vs ${decisions}`);
  assert(s2.stateManager.getProject(p2.id).phase === "completed",
    "step() manual no completó el proyecto");
});

// Extra — verification failure → repair → sin progreso → paused
// persistente (post-Repair MVP el proyecto ya no termina en failed aquí).
await t("verificación sin progreso → paused persistente en runs sucesivos", async () => {
  const failVerifier: TaskVerifier = {
    verifyTask: (task: { id: string }) => ({
      taskId: task.id, passed: false, findings: ["rejected"]
    })
  };
  const agent = new TraceAgent();
  const { stateManager, strategicService, approvalGate, engine } =
    build(agent, failVerifier);
  const project = await analyzedProject(strategicService);
  approvalGate.approve(project.id);
  const run1 = await engine.run(project.id);
  assert(run1.stoppedReason === "paused" || run1.stoppedReason === "blocked",
    `esperaba paused/blocked, llegó ${run1.stoppedReason}`);
  const p = stateManager.getProject(project.id);
  assert(p.status === "paused", `proyecto no quedó paused: ${p.status}`);
  const executions = agent.receivedTasks.length;
  const run2 = await engine.run(project.id);
  assert(run2.cycles === 1 && run2.stoppedReason === "paused",
    "run() sobre paused no terminó en 1 ciclo");
  assert(agent.receivedTasks.length === executions, "se re-ejecutó tras bloqueo");
});

// Extra — trazabilidad completa en wait y block.
await t("trazabilidad completa en decisiones wait/block", async () => {
  const { stateManager, strategicService, engine } = build(new TraceAgent());
  const project = await analyzedProject(strategicService);
  await engine.run(project.id); // wait terminal
  const waitTrace = (stateManager.getProject(project.id).autonomyTrace ?? [])[0];
  assert(waitTrace && waitTrace.cycle === 1 && waitTrace.action === "wait" &&
    waitTrace.phaseFrom === "approval" && waitTrace.phaseTo === "approval" &&
    waitTrace.reason && waitTrace.at,
    `trace wait incompleto: ${JSON.stringify(waitTrace)}`);
});

console.log(`\n${ok} PASSED · ${fail} FAILED\n`);
if (fail > 0) process.exit(1);
