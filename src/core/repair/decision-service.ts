import {
  RepairAssessment,
  RepairAssessmentInput,
  RepairDecisionService
} from "./contracts.js";
import { REPLAN_DEFAULTS } from "../replanning/contracts.js";

/**
 * Stable signature of the findings: sorted taskId:finding pairs. If two
 * consecutive verifications produce the same signature, the repair
 * produced no progress → block (never repeat the same thing forever).
 */
export function findingsSignature(input: RepairAssessmentInput): string {
  return input.report.taskVerifications
    .filter(item => !item.passed)
    .flatMap(item => item.findings.map(f => `${item.taskId}:${f}`))
    .sort()
    .join("|");
}

/**
 * Conservative decision:
 *   · same signature as the previous cycle   → block (no progress);
 *   · repairCount exhausted                   → block (human);
 *   · findings NOT attributable to tasks      → block (when in doubt);
 *   · taskVerification that does not map to
 *     any project task                        → block;
 *   · any ambiguity                           → block, never assume repair;
 *   · only if EVERY finding maps to an
 *     existing completed task                 → repair.
 * "fail" is reserved: in the MVP no path produces it (an unattributed
 * verification failure pauses the project for human review).
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

    // ---- Conservative classification by kind ----
    // Explicit "unknown" or mixed classes → block, never assume.
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

    // ---- plan_invalid → REPLAN (independent budget) ----
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

    // ---- task_execution → REPAIR (independent budget) ----
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
      // Only a completed task can be reopened for repair; a finding
      // on a non-completed task is ambiguous → block.
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
