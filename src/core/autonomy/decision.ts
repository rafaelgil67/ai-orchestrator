import type { ProjectState } from "../project-state/types.js";
import type { LoopDecision } from "./contracts.js";
import type { VerificationReport } from "../verification/contracts.js";

export interface DecisionOutcome {
  decision: LoopDecision;
  reason: string;
  /** Tarea candidata a retry cuando la decisión es "retry". */
  retryTaskId?: string;
}

/**
 * Modelo de decisión post-ejecución. Reglas:
 *   · tarea fallida con retryCount < maxRetries      → retry;
 *   · tarea fallida con presupuesto agotado          → block;
 *   · todas las tareas completadas                   → continue
 *     (transición a verification);
 *   · pendientes sin ejecutables y sin fallidas      → block
 *     (deadlock de dependencias);
 *   · resto                                          → continue.
 */
export function decideAfterExecution(
  project: ProjectState
): DecisionOutcome {
  const failed = project.tasks.filter(
    task => task.status === "failed"
  );

  const retryable = failed.find(
    task => task.retryCount < task.maxRetries
  );

  if (retryable) {
    return {
      decision: "retry",
      reason:
        `Task ${retryable.id} failed and has retry budget ` +
        `(${retryable.retryCount}/${retryable.maxRetries}).`,
      retryTaskId: retryable.id
    };
  }

  if (failed.length > 0) {
    return {
      decision: "block",
      reason:
        `Task ${failed[0].id} exhausted maxRetries ` +
        `(${failed[0].retryCount}/${failed[0].maxRetries}). ` +
        `Human intervention required.`
    };
  }

  const allCompleted =
    project.tasks.length > 0 &&
    project.tasks.every(task => task.status === "completed");

  if (allCompleted) {
    return {
      decision: "continue",
      reason:
        "All tasks completed; project advances to verification."
    };
  }

  const executable = project.tasks.some(task =>
    (task.status === "pending" || task.status === "ready") &&
    task.dependsOn.every(dependencyId =>
      project.tasks.find(
        item => item.id === dependencyId
      )?.status === "completed"
    )
  );

  // Sin ejecutables no hay "continue" válido: plan vacío, deadlock de
  // dependencias o tareas atascadas en "running" son todos deadlock —
  // bloqueo inmediato en lugar de consumir ciclos en "no_work".
  if (!executable) {
    if (project.tasks.length === 0) {
      return {
        decision: "block",
        reason:
          "No work: project is in execution but the plan produced " +
          "no tasks."
      };
    }

    const running = project.tasks.find(
      task => task.status === "running"
    );

    if (running) {
      return {
        decision: "block",
        reason:
          `Task ${running.id} is stuck in "running" state ` +
          `without an active execution. Human review required.`
      };
    }

    return {
      decision: "block",
      reason:
        "Dependency deadlock: pending tasks exist but none " +
        "has all dependencies satisfied."
    };
  }

  return {
    decision: "continue",
    reason: "Executable work remains; loop proceeds."
  };
}

/**
 * Modelo de decisión post-verificación: el proyecto solo puede
 * completarse si el reporte de verificación pasa. En caso contrario el
 * proyecto queda en failed y requiere autorización humana para reanudarse.
 */
export function decideAfterVerification(
  report: VerificationReport
): DecisionOutcome {
  if (report.passed) {
    return {
      decision: "complete",
      reason: "Verification passed; project meets its criteria."
    };
  }

  return {
    decision: "fail",
    reason:
      `Verification failed with ${report.findings.length} ` +
      `finding(s).`
  };
}
