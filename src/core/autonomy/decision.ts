import type { ProjectState } from "../project-state/types.js";
import type { LoopDecision } from "./contracts.js";
import type { VerificationReport } from "../verification/contracts.js";

export interface DecisionOutcome {
  decision: LoopDecision;
  reason: string;
  /** Task candidate for retry when the decision is "retry". */
  retryTaskId?: string;
}

/**
 * Post-execution decision model. Rules:
 *   · failed task with retryCount < maxRetries       → retry;
 *   · failed task with budget exhausted              → block;
 *   · all tasks completed                            → continue
 *     (transition to verification);
 *   · pending tasks, none executable, none failed    → block
 *     (dependency deadlock);
 *   · otherwise                                      → continue.
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

  // With no executable work there is no valid "continue": an empty
  // plan, a dependency deadlock or tasks stuck in "running" are all
  // deadlocks — block immediately instead of burning cycles on
  // "no_work".
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
 * Post-verification decision model: the project can only complete if
 * the verification report passes. Otherwise the project ends in failed
 * and requires human authorization to resume.
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
