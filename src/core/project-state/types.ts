import { AgentResult } from "../../agents/contracts/agent.js";

export type ProjectPhase =
  | "discovery"
  | "diagnosis"
  | "approval"
  | "revision"
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

export interface TaskAttempt {
  attempt: number;
  retry: boolean;
  agentId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  summary: string;
  result: AgentResult;
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
  acceptanceCriteria: string[];

  attempts: number;
  maxRetries: number;
  retryCount: number;

  assignedAgent?: string;

  result?: AgentResult;

  lastFailureReason?: string;
  lastAttemptAt?: string;

  attemptHistory: TaskAttempt[];
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
