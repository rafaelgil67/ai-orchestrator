// Repair Engine MVP — contratos. Independiente de project-state (sin
// ciclos de imports): los tipos referencian IDs/strings solamente.
import type { VerificationReport } from "../verification/contracts.js";
import type { ProjectState } from "../project-state/types.js";

/** Contexto que recibe la tarea reabierta para reparación. */
export interface RepairContext {
  /** Findings de la verificación que provocaron la reparación. */
  failedFindings: string[];
  /** Número de ciclo de reparación (1 = primera reparación). */
  repairCycle: number;
  /** Resúmenes de intentos previos para que el agente no repita el fallo. */
  previousAttemptSummaries: string[];
  reason: string;
}

export type RepairDecision = "repair" | "replan" | "block" | "fail";

export interface RepairAssessment {
  decision: RepairDecision;
  /** Tareas concretas a reparar; vacío si decision !== "repair". */
  taskIds: string[];
  reason: string;
  /** true cuando los findings son idénticos a los del ciclo anterior —
   *  la reparación anterior no produjo progreso. */
  noProgress?: boolean;
}

export interface RepairAssessmentInput {
  report: VerificationReport;
  project: ProjectState;
  repairCount: number;
  maxRepairs: number;
  /** Presupuesto de replanificación (independiente de repair). */
  replanCount?: number;
  maxReplans?: number;
  /** Signature de findings del ciclo anterior (metadata.lastFindingsSignature). */
  previousSignature?: string;
}

export interface RepairDecisionService {
  assess(input: RepairAssessmentInput): RepairAssessment;
}

export const REPAIR_DEFAULTS = {
  MAX_REPAIRS: 2
} as const;
