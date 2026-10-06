// Replan Engine MVP — contratos. Independiente de Planner/PlanningService:
// el replan es un mecanismo correctivo ADITIVO — jamás toca tareas
// existentes ni el blueprint original.

/** Finding clasificado como plan_invalid que motiva el replan. */
export interface ReplanFinding {
  /** Tarea de la que surge el finding; undefined si es global. */
  taskId?: string;
  finding: string;
}

export interface ReplanRequest {
  projectId: string;
  /** Findings plan_invalid que invalidan el plan vigente. */
  failedFindings: ReplanFinding[];
  /** IDs de tareas completed — preservadas, nunca reabiertas. */
  preservedTaskIds: string[];
  /** Número de ciclo de replanificación (1 = primer replan). */
  replanCycle: number;
  reason: string;
}

export interface ReplanResult {
  success: boolean;
  /** IDs de las tareas correctivas insertadas. */
  addedTaskIds: string[];
  reason: string;
}

export interface ReplanService {
  replan(request: ReplanRequest): ReplanResult;
}

export const REPLAN_DEFAULTS = {
  MAX_REPLANS: 1
} as const;
