export type ProjectPhase =
  | "discovery"
  | "diagnosis"
  | "approval"
  | "planning"
  | "execution"
  | "verification"
  | "deployment"
  | "completed"
  | "failed";

export type ProjectStatus =
  | "draft"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export interface ProjectBrief {
  name: string;
  objective: string;
  originalPrompt: string;
  constraints: string[];
}

export interface ProjectDecision {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  createdAt: string;
}

export interface ProjectTask {
  id: string;
  title: string;
  description: string;
  role: string;
  status:
    | "pending"
    | "ready"
    | "running"
    | "blocked"
    | "completed"
    | "failed";
  dependsOn: string[];
  attempts: number;
  assignedAgent?: string;
}

export interface ProjectState {
  id: string;
  createdAt: string;
  updatedAt: string;

  phase: ProjectPhase;
  status: ProjectStatus;

  brief: ProjectBrief;

  diagnosis?: string;
  improvedSpecification?: string;
  architecture?: string;

  tasks: ProjectTask[];
  decisions: ProjectDecision[];

  activeAgent?: string;

  quality: {
    testsPassed: number;
    testsFailed: number;
    securityIssues: number;
    qualityScore?: number;
  };

  metadata: Record<string, unknown>;
}
