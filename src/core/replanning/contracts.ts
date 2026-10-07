// Replan Engine MVP — contracts. Independent of Planner/PlanningService:
// replanning is an ADDITIVE corrective mechanism — it never touches
// existing tasks or the original blueprint.

/** Finding classified as plan_invalid that motivates the replan. */
export interface ReplanFinding {
  /** Task the finding originates from; undefined when global. */
  taskId?: string;
  finding: string;
}

export interface ReplanRequest {
  projectId: string;
  /** plan_invalid findings that invalidate the current plan. */
  failedFindings: ReplanFinding[];
  /** IDs of completed tasks — preserved, never reopened. */
  preservedTaskIds: string[];
  /** Replan cycle number (1 = first replan). */
  replanCycle: number;
  reason: string;
}

export interface ReplanResult {
  success: boolean;
  /** IDs of the inserted corrective tasks. */
  addedTaskIds: string[];
  reason: string;
}

export interface ReplanService {
  replan(request: ReplanRequest): ReplanResult;
}

export const REPLAN_DEFAULTS = {
  MAX_REPLANS: 1
} as const;
