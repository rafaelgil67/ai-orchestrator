import { ProjectTask } from "../project-state/types.js";

/**
 * Clasificación opcional del fallo (REPLAN Engine):
 *   · "task_execution" — la tarea se ejecutó mal → repair;
 *   · "plan_invalid"   — el plan vigente es insuficiente → replan;
 *   · "unknown"        — no clasificable → block (nunca asumir).
 * Ausente = comportamiento previo (verificación por tarea → repair).
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
 * Verificador de una tarea completada. Inyectable para sustituir la
 * heurística por defecto (result.success + sin issues) por un agente QA
 * real en fases posteriores.
 */
export interface TaskVerifier {
  verifyTask(task: ProjectTask): Promise<TaskVerification> | TaskVerification;
}
