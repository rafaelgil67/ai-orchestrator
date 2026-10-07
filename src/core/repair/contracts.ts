// Repair Engine MVP — contracts. Independent of project-state (no
// import cycles): the types reference IDs/strings only.
import type { VerificationReport } from "../verification/contracts.js";
import type { ProjectState } from "../project-state/types.js";

/** Context received by a task reopened for repair. */
export interface RepairContext {
  /** Verification findings that triggered the repair. */
  failedFindings: string[];
  /** Repair cycle number (1 = first repair). */
  repairCycle: number;
  /** Summaries of previous attempts so the agent does not repeat the failure. */
  previousAttemptSummaries: string[];
  reason: string;
}

export type RepairDecision = "repair" | "replan" | "block" | "fail";

export interface RepairAssessment {
  decision: RepairDecision;
  /** Concrete tasks to repair; empty when decision !== "repair". */
  taskIds: string[];
  reason: string;
  /** true when the findings are identical to the previous cycle's —
   *  the previous repair produced no progress. */
  noProgress?: boolean;
}

export interface RepairAssessmentInput {
  report: VerificationReport;
  project: ProjectState;
  repairCount: number;
  maxRepairs: number;
  /** Replan budget (independent of repair). */
  replanCount?: number;
  maxReplans?: number;
  /** Findings signature from the previous cycle (metadata.lastFindingsSignature). */
  previousSignature?: string;
}

export interface RepairDecisionService {
  assess(input: RepairAssessmentInput): RepairAssessment;
}

export const REPAIR_DEFAULTS = {
  MAX_REPAIRS: 2
} as const;
