import type {
  AutonomyTrace,
  LoopDecision,
  ProjectState
} from "../project-state/types.js";

// LoopDecision and AutonomyTrace live in project-state/types.ts because
// they are part of the ProjectState shape (autonomyTrace field). They are
// re-exported here so consumers of the autonomy module keep a single
// contracts entry point — without an import cycle.
export type { AutonomyTrace, LoopDecision };

export interface LoopStepResult {
  projectId: string;
  decision: LoopDecision;
  terminal: boolean;
  trace: AutonomyTrace;
  project: ProjectState;
}

export type LoopStoppedReason =
  | "completed"
  | "blocked"
  | "awaiting_approval"
  | "paused"
  | "failed"
  | "max_cycles";

export interface AutonomyConfig {
  /** Absolute protection against infinite loops (default: 50). */
  maxCycles?: number;
  /** Replan budget per project (default: 1). */
  maxReplans?: number;
}

export interface LoopRunResult {
  projectId: string;
  cycles: number;
  stoppedReason: LoopStoppedReason;
  decisions: LoopDecision[];
  project: ProjectState;
}
