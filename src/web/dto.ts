/**
 * Web layer DTO serialization — converts internal ProjectState into a
 * safe, read-only view for the browser. Only whitelisted fields cross the
 * boundary; internals (metadata, repairContext, raw attempt payloads)
 * stay server-side.
 */
import type {
  ProjectState,
  AutonomyTrace
} from "../core/project-state/types.js";

export interface TaskDTO {
  id: string;
  title: string;
  description: string;
  role: string;
  status: string;
  attempts: number;
  retryCount: number;
  maxRetries: number;
  assignedAgent?: string;
  lastFailureReason?: string;
  resultSummary?: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
}

export interface DecisionDTO {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  createdAt: string;
}

export interface ProjectDTO {
  phase: string;
  status: string;
  name: string;
  brief: {
    name: string;
    objective: string;
    constraints: string[];
  };
  /** Parsed strategic analysis (executive summary, risks, …), when available. */
  analysis?: Record<string, unknown>;
  improvedSpecification?: string;
  tasks: TaskDTO[];
  decisions: DecisionDTO[];
  counters: {
    cycles: number;
    repairs: number;
    replans: number;
    retries: number;
  };
  quality: ProjectState["quality"];
  activeAgent?: string;
}

export interface SessionDTO {
  sessionId: string;
  createdAt: string;
  running: boolean;
  stoppedReason?: string;
  project: ProjectDTO;
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseAnalysis(
  diagnosis: string | undefined
): Record<string, unknown> | undefined {
  if (!diagnosis) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(diagnosis);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // diagnosis stays internal if it is not JSON — never crash the API
  }
  return undefined;
}

export function serializeProject(project: ProjectState): ProjectDTO {
  return {
    phase: project.phase,
    status: project.status,
    name: project.brief.name,
    brief: {
      name: project.brief.name,
      objective: project.brief.objective,
      constraints: [...project.brief.constraints]
    },
    analysis: parseAnalysis(project.diagnosis),
    improvedSpecification: project.improvedSpecification,
    tasks: project.tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      role: task.role,
      status: task.status,
      attempts: task.attempts,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
      assignedAgent: task.assignedAgent,
      lastFailureReason: task.lastFailureReason,
      resultSummary: task.result?.summary,
      acceptanceCriteria: [...task.acceptanceCriteria],
      dependsOn: [...task.dependsOn]
    })),
    decisions: project.decisions.map(d => ({ ...d })),
    counters: {
      cycles: project.autonomyTrace?.length ?? 0,
      repairs: safeNumber(project.metadata.repairCount),
      replans: safeNumber(project.metadata.replanCount),
      retries: project.tasks.reduce(
        (total, task) => total + task.retryCount,
        0
      )
    },
    quality: { ...project.quality },
    activeAgent: project.activeAgent
  };
}

export function serializeTrace(
  trace: AutonomyTrace[] | undefined
): AutonomyTrace[] {
  return (trace ?? []).map(entry => ({ ...entry }));
}
