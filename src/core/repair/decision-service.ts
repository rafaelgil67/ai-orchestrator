import {
  RepairAssessment,
  RepairAssessmentInput,
  RepairDecisionService
} from "./contracts.js";
import { REPLAN_DEFAULTS } from "../replanning/contracts.js";

/**
 * Signature estable de los findings: taskId:finding ordenados. Si dos
 * verificaciones consecutivas producen la misma signature, la reparación
 * no produjo progreso → block (nunca repetir lo mismo indefinidamente).
 */
export function findingsSignature(input: RepairAssessmentInput): string {
  return input.report.taskVerifications
    .filter(item => !item.passed)
    .flatMap(item => item.findings.map(f => `${item.taskId}:${f}`))
    .sort()
    .join("|");
}

/**
 * Decisión conservadora:
 *   · mismo signature que el ciclo anterior  → block (sin progreso);
 *   · repairCount agotado                    → block (humano);
 *   · findings NO atribuibles a tareas       → block (ante la duda);
 *   · taskVerification que no corresponde a
 *     ninguna tarea del proyecto             → block;
 *   · cualquier ambigüedad                   → block, nunca asumir repair;
 *   · solo si TODO finding se atribuye a una
 *     tarea existente y completada           → repair.
 * "fail" queda reservado: en el MVP ninguna vía la produce (una
 * verificación sin atribución pausa el proyecto para revisión humana).
 */
export class DefaultRepairDecisionService
  implements RepairDecisionService {

  assess(input: RepairAssessmentInput): RepairAssessment {
    const signature = findingsSignature(input);

    if (
      input.previousSignature !== undefined &&
      signature === input.previousSignature
    ) {
      return {
        decision: "block",
        taskIds: [],
        reason:
          "No progress: verification findings are identical to the " +
          "previous cycle. Repair produced no change; human review required.",
        noProgress: true
      };
    }

    const failed = input.report.taskVerifications.filter(
      item => !item.passed
    );

    if (failed.length === 0) {
      return {
        decision: "block",
        taskIds: [],
        reason:
          "Verification failed but no task-level finding could be " +
          "attributed. Ambiguous failure; human review required."
      };
    }

    // ---- Clasificación conservadora por kind ----
    // "unknown" explícito o mezcla de clases → block, jamás asumir.
    const unclassified = failed.filter(f => f.kind === "unknown");
    if (unclassified.length > 0) {
      return {
        decision: "block",
        taskIds: [],
        reason:
          `${unclassified.length} finding(s) marked "unknown"; cannot ` +
          `classify failure. Human review required.`
      };
    }

    const planInvalid = failed.filter(f => f.kind === "plan_invalid");
    const taskExecution = failed.filter(
      f => f.kind === undefined || f.kind === "task_execution"
    );

    if (planInvalid.length > 0 && taskExecution.length > 0) {
      return {
        decision: "block",
        taskIds: [],
        reason:
          `Mixed findings (${taskExecution.length} task_execution + ` +
          `${planInvalid.length} plan_invalid); ambiguous recovery ` +
          `strategy. Human review required.`
      };
    }

    // ---- plan_invalid → REPLAN (presupuesto independiente) ----
    if (planInvalid.length === failed.length) {
      const replanCount = input.replanCount ?? 0;
      const maxReplans =
        input.maxReplans ?? REPLAN_DEFAULTS.MAX_REPLANS;
      if (replanCount >= maxReplans) {
        return {
          decision: "block",
          taskIds: [],
          reason:
            `Replan budget exhausted (${replanCount}/` +
            `${maxReplans}). Human intervention required.`
        };
      }
      return {
        decision: "replan",
        taskIds: planInvalid.map(f => f.taskId),
        reason:
          `Verification failure classified as plan_invalid on ` +
          `${planInvalid.length} task(s); scheduling replan cycle ` +
          `${replanCount + 1}.`
      };
    }

    // ---- task_execution → REPAIR (presupuesto independiente) ----
    if (input.repairCount >= input.maxRepairs) {
      return {
        decision: "block",
        taskIds: [],
        reason:
          `Repair budget exhausted (${input.repairCount}/` +
          `${input.maxRepairs}). Human intervention required.`
      };
    }

    const unattributable = taskExecution.filter(item => {
      const task = input.project.tasks.find(
        t => t.id === item.taskId
      );
      // Solo una tarea completada puede reabrirse para reparación;
      // un finding sobre una tarea no-completada es ambiguo → block.
      return !task || task.status !== "completed";
    });

    if (unattributable.length > 0) {
      return {
        decision: "block",
        taskIds: [],
        reason:
          `Verification findings could not be clearly attributed to ` +
          `completed tasks (${unattributable.length} finding(s) on ` +
          `unknown or non-completed tasks). Human review required.`
      };
    }

    return {
      decision: "repair",
      taskIds: taskExecution.map(item => item.taskId),
      reason:
        `Verification failure attributed to ${taskExecution.length} ` +
        `task(s); scheduling repair cycle ${input.repairCount + 1}.`
    };
  }
}
