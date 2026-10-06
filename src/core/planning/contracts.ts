export type PlanningTaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "completed"
  | "failed";

export interface PlannedTask {
  id: string;
  projectId: string;

  title: string;
  description: string;

  capability: string;

  status: PlanningTaskStatus;

  dependsOn: string[];

  acceptanceCriteria: string[];

  inputs: Record<string, unknown>;

  priority: "critical" | "high" | "medium" | "low";

  assignedAgentId?: string;

  metadata?: Record<string, unknown>;
}

export interface PlanningRequest {
  projectId: string;

  projectName: string;

  objective: string;

  requirements: string[];

  architecture?: string;

  definitionOfDone: string[];

  additionalContext?: string[];
}

export interface PlanningResult {
  projectId: string;

  tasks: PlannedTask[];

  executionOrder: string[];

  summary: string;
}
