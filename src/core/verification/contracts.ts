import { ProjectTask } from "../project-state/types.js";

/**
 * Optional failure classification (REPLAN Engine):
 *   · "task_execution" — the task was executed incorrectly → repair;
 *   · "plan_invalid"   — the current plan is insufficient → replan;
 *   · "unknown"        — not classifiable → block (never assume).
 * Absent = previous behavior (per-task verification → repair).
 */
export type TaskFailureKind =
  | "task_execution"
  | "plan_invalid"
  | "unknown";

export interface TaskVerification {
  taskId: string;
  passed: boolean;
  findings: string[];
  kind?: TaskFailureKind;
}

export interface VerificationReport {
  projectId: string;
  passed: boolean;
  taskVerifications: TaskVerification[];
  findings: string[];
  verifiedAt: string;
}

/**
 * Verifier for a completed task. Injectable to replace the default
 * heuristic (result.success + no issues) with a real QA agent in
 * later phases.
 */
export interface TaskVerifier {
  verifyTask(task: ProjectTask): Promise<TaskVerification> | TaskVerification;
}
