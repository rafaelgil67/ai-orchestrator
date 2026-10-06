import type {
  AutonomyTrace,
  LoopDecision,
  ProjectState
} from "../project-state/types.js";

// LoopDecision y AutonomyTrace viven en project-state/types.ts porque
// forman parte de la forma de ProjectState (campo autonomyTrace). Se
// re-exportan aquí para que los consumidores del módulo autonomy sigan
// usando un único punto de contratos — sin ciclo de imports.
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
  /** Protección absoluta contra loops infinitos (defecto: 50). */
  maxCycles?: number;
  /** Presupuesto de replanificaciones por proyecto (defecto: 1). */
  maxReplans?: number;
}

export interface LoopRunResult {
  projectId: string;
  cycles: number;
  stoppedReason: LoopStoppedReason;
  decisions: LoopDecision[];
  project: ProjectState;
}
