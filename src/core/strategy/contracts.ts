export type RiskLevel = "low" | "medium" | "high" | "critical";

export type RequirementPriority =
  | "must"
  | "should"
  | "could"
  | "out_of_scope";

export interface Requirement {
  id: string;
  title: string;
  description: string;
  priority: RequirementPriority;
  source: "explicit" | "inferred" | "recommended";
  acceptanceCriteria: string[];
}

export interface Ambiguity {
  id: string;
  description: string;
  impact: string;
  suggestedResolution: string;
  requiresUserDecision: boolean;
}

export interface Risk {
  id: string;
  description: string;
  level: RiskLevel;
  mitigation: string;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  rationale: string;
  impact: "low" | "medium" | "high";
}

export interface ArchitectureProposal {
  summary: string;
  frontend?: string;
  backend?: string;
  database?: string;
  infrastructure?: string;
  integrations: string[];
  security: string[];
  scalability: string[];
}

export interface MasterPlanPhase {
  id: string;
  name: string;
  objective: string;
  deliverables: string[];
  dependencies: string[];
}

export interface ProjectBlueprint {
  projectName: string;
  executiveSummary: string;
  originalPrompt: string;

  interpretedObjective: string;

  requirements: Requirement[];

  ambiguities: Ambiguity[];

  risks: Risk[];

  recommendations: Recommendation[];

  architecture: ArchitectureProposal;

  masterPlan: MasterPlanPhase[];

  definitionOfDone: string[];

  assumptions: string[];

  requiresApproval: boolean;

  generatedAt: string;
}

export interface StrategicAnalysisRequest {
  projectName?: string;
  prompt: string;
  additionalContext?: string[];
}

export interface StrategicBrain {
  analyze(
    request: StrategicAnalysisRequest
  ): Promise<ProjectBlueprint>;
}
