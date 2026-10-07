import { AgentResult } from "../../agents/contracts/agent.js";
import type { RepairContext } from "../repair/contracts.js";

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

export type LoopDecision =
  | "continue"
  | "retry"
  | "block"
  | "wait"
  | "complete"
  | "fail"
  | "repair"
  | "replan";

export interface AutonomyTrace {
  cycle: number;
  phaseFrom: ProjectPhase;
  phaseTo: ProjectPhase;
  action: LoopDecision;
  taskId?: string;
  agentId?: string;
  attempt?: number;
  outcome: string;
  reason: string;
  at: string;
}

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

  /** Repair context injected by the Repair Engine after a verification
   *  failure attributable to this task. Additive and optional; the
   *  executor transports it inside AgentTask.inputs. */
  repairContext?: RepairContext;

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

  /** Autonomy Loop Engine traceability. Additive and optional:
   *  projects created before this phase do not have it.
   *  Complements (does not replace) each task's attemptHistory. */
  autonomyTrace?: AutonomyTrace[];

  quality: {
    testsPassed: number;
    testsFailed: number;
    securityIssues: number;
    qualityScore?: number;
  };

  metadata: Record<string, unknown>;
}
