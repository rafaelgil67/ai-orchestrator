import { ProjectStateManager } from "../project-state/manager.js";
import {
  ReplanRequest,
  ReplanResult,
  ReplanService
} from "./contracts.js";

/**
 * Replan Engine MVP — planificación correctiva ADITIVA.
 *
 * Reglas duras:
 *   · jamás toca, borra ni reabre una tarea existente;
 *   · cada finding plan_invalid produce UNA tarea correctiva nueva;
 *   · dependsOn solo apunta a tareas existentes (nunca entre nuevas,
 *     así que un ciclo es imposible por construcción);
 *   · validación ATÓMICA: si algún finding es inválido no se inserta
 *     ninguna tarea — nunca un plan parcialmente inválido;
 *   · dedup por `${taskId}:${finding}` — el mismo finding no genera
 *     tareas duplicadas en un mismo replan.
 */
export class DefaultReplanService implements ReplanService {
  constructor(
    private readonly stateManager: ProjectStateManager
  ) {}

  replan(request: ReplanRequest): ReplanResult {
    const project = this.stateManager.getProject(request.projectId);
    const existingIds = new Set(project.tasks.map(t => t.id));

    if (request.failedFindings.length === 0) {
      return {
        success: false,
        addedTaskIds: [],
        reason:
          "Replan requested without plan_invalid findings; nothing " +
          "to correct."
      };
    }

    // Validación atómica: todos los taskId referenciados deben existir.
    const unresolvable = request.failedFindings.filter(
      f => f.taskId !== undefined && !existingIds.has(f.taskId)
    );
    if (unresolvable.length > 0) {
      return {
        success: false,
        addedTaskIds: [],
        reason:
          `Replan refused: ${unresolvable.length} finding(s) reference ` +
          `non-existent tasks (${unresolvable
            .map(f => f.taskId)
            .join(", ")}). No tasks inserted.`
      };
    }

    // Dedup conservador dentro del mismo replan.
    const seen = new Set<string>();
    const unique = request.failedFindings.filter(f => {
      const key = `${f.taskId ?? ""}:${f.finding}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const addedTaskIds: string[] = [];
    for (const finding of unique) {
      const origin = finding.taskId
        ? project.tasks.find(t => t.id === finding.taskId)
        : undefined;
      const created = this.stateManager.addTask(request.projectId, {
        title: `[REPLAN] Corrective: ${finding.finding.slice(0, 60)}`,
        description:
          `Replan cycle ${request.replanCycle}. The current plan was ` +
          `judged invalid: "${finding.finding}". ` +
          (origin
            ? `Origin task: ${origin.title} (${origin.id}). `
            : "") +
          `Correct the plan-level outcome without reopening completed ` +
          `tasks. Reason: ${request.reason}`,
        // Hereda el rol de la tarea origen para que el agente correcto
        // la ejecute; fallback "coding".
        role: origin?.role ?? "coding",
        status: "pending",
        // Solo depende de la tarea origen (completed) si existe —
        // nunca de tareas nuevas → ciclo imposible.
        dependsOn: origin ? [origin.id] : [],
        acceptanceCriteria: [
          `Resolves plan-invalid finding: ${finding.finding}`
        ],
        attempts: 0,
        maxRetries: 2,
        retryCount: 0,
        attemptHistory: []
      });
      addedTaskIds.push(created.id);
    }

    return {
      success: true,
      addedTaskIds,
      reason:
        `Replan added ${addedTaskIds.length} corrective task(s): ` +
        `${addedTaskIds.join(", ")}.`
    };
  }
}
