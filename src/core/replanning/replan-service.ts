import { ProjectStateManager } from "../project-state/manager.js";
import {
  ReplanRequest,
  ReplanResult,
  ReplanService
} from "./contracts.js";

/**
 * Replan Engine MVP — ADDITIVE corrective planning.
 *
 * Hard rules:
 *   · never touches, deletes or reopens an existing task;
 *   · each plan_invalid finding produces ONE new corrective task;
 *   · dependsOn only points to existing tasks (never between new
 *     ones, so a cycle is impossible by construction);
 *   · ATOMIC validation: if any finding is invalid, no task is
 *     inserted — never a partially invalid plan;
 *   · dedup by `${taskId}:${finding}` — the same finding does not
 *     produce duplicate tasks within a single replan.
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

    // Atomic validation: every referenced taskId must exist.
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

    // Conservative dedup within the same replan.
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
        // Inherits the origin task's role so the right agent executes
        // it; falls back to "coding".
        role: origin?.role ?? "coding",
        status: "pending",
        // Depends only on the origin task (completed) if it exists —
        // never on new tasks → cycles are impossible.
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
