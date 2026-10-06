// Replan Engine MVP — plan_invalid → tareas correctivas aditivas.
// Reglas verificadas: completed jamás se toca, deps solo a existentes,
// maxReplans, noProgress, gate intacto, trace completo.
//   npx tsx tests/autonomy-replan-test.ts
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

/** plan_invalid UNA vez sobre un rol → replan → éxito. */
class PlanInvalidOnceVerifier implements TaskVerifier {
  private fired = false;
  constructor(private role: string) {}
  verifyTask(task: ProjectTask): TaskVerification {
    if (!this.fired && task.role === this.role) {
      this.fired = true;
      return {
        taskId: task.id, passed: false,
        findings: ["plan missing coverage for this role"],
        kind: "plan_invalid"
      };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

/** plan_invalid SIEMPRE sobre la MISMA tarea original (finding fijo). */
class PlanInvalidPersistentVerifier implements TaskVerifier {
  private target: string | null = null;
  constructor(private label: (n: number) => string, private role: string) {}
  private n = 0;
  verifyTask(task: ProjectTask): TaskVerification {
    // Solo ataca la primera tarea capturada del rol — las tareas
    // correctivas nuevas pasan limpias → signature estable si el
    // finding es constante.
    if (task.role === this.role && !task.title.startsWith("[REPLAN]")) {
      this.target = this.target ?? task.id;
      if (task.id === this.target) {
        return {
          taskId: task.id, passed: false,
          findings: [this.label(++this.n)],
          kind: "plan_invalid"
        };
      }
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

/** plan_invalid apuntando a una tarea inexistente → replan inválido. */
class PlanInvalidGhostVerifier implements TaskVerifier {
  private fired = false;
  verifyTask(task: ProjectTask): TaskVerification {
    if (!this.fired) {
      this.fired = true;
      return {
        taskId: "task_ghost_nonexistent", passed: false,
        findings: ["references a task that does not exist"],
        kind: "plan_invalid"
      };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

/** Falla una vez por tarea sin kind → task_execution → repair. */
class FailOnceVerifier implements TaskVerifier {
  private failed = new Set<string>();
  verifyTask(task: ProjectTask): TaskVerification {
    if (!this.failed.has(task.id)) {
      this.failed.add(task.id);
      return { taskId: task.id, passed: false, findings: ["exec flaw"] };
    }
    return { taskId: task.id, passed: true, findings: [] };
  }
}

function build(verifier?: TaskVerifier, maxReplans?: number) {
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
    undefined, undefined, undefined, maxReplans
  );
  return { stateManager, strategicService, approvalGate, engine, agent };
}

async function approvedProject(sys: ReturnType<typeof build>) {
  const r = await sys.strategicService.analyze({
    projectName: "Replan Test",
    prompt: "Proyecto para probar el replan engine."
  });
  sys.approvalGate.approve(r.project.id, "aprobado en test");
  return r.project;
}

console.log("\nReplan Engine MVP — pruebas\n");

// 1+2+3+4+5+6+12+13. plan_invalid → replan → nuevas tareas → completed.
await t("plan_invalid → replan → tareas correctivas → completed", async () => {
  const sys = build(new PlanInvalidOnceVerifier("testing"));
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "completed", `esperaba completed, llegó ${run.stoppedReason}`);
  assert(run.decisions.includes("replan"), `sin decisión replan: ${run.decisions}`);

  const p = sys.stateManager.getProject(project.id);
  assert(p.metadata.replanCount === 1, `replanCount=${p.metadata.replanCount} ≠ 1`);

  // Correctivas identificables por prefijo; las demás son originales.
  const added = p.tasks.filter(x => x.title.startsWith("[REPLAN]"));
  const originalTasks = p.tasks.filter(x => !x.title.startsWith("[REPLAN]"));
  const originalIds = new Set(originalTasks.map(x => x.id));
  assert(added.length === 1, `esperaba 1 tarea correctiva, hay ${added.length}`);
  assert(originalTasks.length === 8, `esperaba 8 originales, hay ${originalTasks.length}`);
  assert(originalTasks
    .every(x => x.status === "completed"), "una original dejó de estar completed");

  // Originales NO se re-ejecutaron (1 intento), correctiva ejecutada.
  assert(originalTasks
    .every(x => x.attemptHistory.length === 1), "una original se re-ejecutó");
  assert(added[0].attemptHistory.length === 1, "la correctiva no se ejecutó");
  assert(added[0].status === "completed", "la correctiva no completó");

  // Dep correcto: solo apunta a tareas existentes.
  assert(added[0].dependsOn.every(d => originalIds.has(d)),
    `dependencia inválida: ${added[0].dependsOn}`);

  // Trace replan completo.
  const trace = (p.autonomyTrace ?? []).find(e => e.action === "replan");
  assert(trace?.cycle > 0 && trace.phaseFrom === "verification" &&
    trace.phaseTo === "execution" && /added tasks/.test(trace.reason),
    `trace replan incorrecto: ${JSON.stringify(trace)}`);
});

// 7. maxReplans=1 → segundo replan → paused.
await t("maxReplans agotado → block + paused", async () => {
  const verifier = new PlanInvalidPersistentVerifier(n => `plan flaw ${n}`, "testing");
  const sys = build(verifier); // maxReplans default = 1
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "paused" || run.stoppedReason === "blocked",
    `esperaba paused/blocked, llegó ${run.stoppedReason}`);
  const p = sys.stateManager.getProject(project.id);
  assert(p.status === "paused", `proyecto no pausado: ${p.status}`);
  assert(p.metadata.replanCount === 1, `replanCount=${p.metadata.replanCount} ≠ 1`);
  const replans = (p.autonomyTrace ?? []).filter(e => e.action === "replan");
  assert(replans.length === 1, `esperaba 1 replan, hubo ${replans.length}`);
});

// 8. Findings idénticos → noProgress → block + paused (sin replan infinito).
await t("findings idénticos post-replan → noProgress → paused", async () => {
  const verifier = new PlanInvalidPersistentVerifier(() => "same flaw", "testing");
  const sys = build(verifier);
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  const p = sys.stateManager.getProject(project.id);
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /no progress/i.test(last.reason),
    `razón inesperada: ${last?.reason}`);
  assert(p.status === "paused", `proyecto no pausado: ${p.status}`);
  assert(p.metadata.replanCount === 1, "replanCount debió quedar en 1");
});

// 9. Finding sobre taskId inexistente → replan inválido → block, sin inserts.
await t("dependencia inexistente → replan rechazado → block sin insertar", async () => {
  const sys = build(new PlanInvalidGhostVerifier());
  const project = await approvedProject(sys);
  await sys.engine.run(project.id);
  const p = sys.stateManager.getProject(project.id);
  assert(p.status === "paused", `proyecto no pausado: ${p.status}`);
  const corrective = p.tasks.filter(x => x.title.startsWith("[REPLAN]"));
  assert(corrective.length === 0,
    `se insertaron ${corrective.length} tareas tras replan inválido`);
  const last = (p.autonomyTrace ?? []).at(-1);
  assert(last?.action === "block" && /Replan refused/.test(last.reason),
    `razón inesperada: ${last?.reason}`);
});

// 10. Replan sin approved → gate bloquea antes de todo.
await t("verification forzado sin approved → block, replan jamás corre", async () => {
  const sys = build(new PlanInvalidOnceVerifier("testing"));
  const r = await sys.strategicService.analyze({
    projectName: "Gate Replan",
    prompt: "Proyecto sin aprobación con fallo plan_invalid."
  });
  sys.stateManager.updatePhase(r.project.id, "verification");
  sys.stateManager.updateStatus(r.project.id, "running");
  const run = await sys.engine.run(r.project.id);
  assert(run.cycles === 1, `debía bloquear en 1 ciclo, llegó ${run.cycles}`);
  assert(!run.decisions.includes("replan"), `replan ejecutado sin aprobación`);
  const p = sys.stateManager.getProject(r.project.id);
  assert(p.status === "paused", `proyecto no pausado: ${p.status}`);
});

// 11. Repair sigue funcionando sin regresión.
await t("repair (sin kind) sigue funcionando — sin regresión", async () => {
  const sys = build(new FailOnceVerifier());
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id);
  assert(run.stoppedReason === "completed", `repair regresión: ${run.stoppedReason}`);
  assert(run.decisions.includes("repair") && !run.decisions.includes("replan"),
    `decisiones inesperadas: ${run.decisions}`);
});

// 14. maxCycles sigue acotando el loop.
await t("run con maxCycles=1 → max_cycles aun con replan disponible", async () => {
  const sys = build(new PlanInvalidOnceVerifier("testing"));
  const project = await approvedProject(sys);
  const run = await sys.engine.run(project.id, { maxCycles: 1 });
  assert(run.stoppedReason === "max_cycles", `esperaba max_cycles, llegó ${run.stoppedReason}`);
  assert(run.cycles === 1, `cycles=${run.cycles} ≠ 1`);
});

console.log(`\n${ok} PASSED · ${fail} FAILED\n`);
if (fail > 0) process.exit(1);
