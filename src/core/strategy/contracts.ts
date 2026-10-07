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

/**
 * JSON Schema for `ProjectBlueprint`, used for OpenAI-compatible
 * Structured Outputs (`response_format: json_schema + strict`).
 *
 * This is the wire-level mirror of the interfaces above, kept in
 * the same file so `contracts.ts` remains the single source of
 * truth. OpenAI strict mode requires every property to be listed
 * in `required` and `additionalProperties: false`; optional TS
 * fields (e.g. ArchitectureProposal.frontend) are therefore marked
 * required here — the model must always emit them ("" or [] when
 * not applicable).
 */
export const PROJECT_BLUEPRINT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectName: { type: "string" },
    executiveSummary: { type: "string" },
    originalPrompt: { type: "string" },
    interpretedObjective: { type: "string" },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          priority: {
            type: "string",
            enum: ["must", "should", "could", "out_of_scope"]
          },
          source: {
            type: "string",
            enum: ["explicit", "inferred", "recommended"]
          },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: [
          "id",
          "title",
          "description",
          "priority",
          "source",
          "acceptanceCriteria"
        ]
      }
    },
    ambiguities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          impact: { type: "string" },
          suggestedResolution: { type: "string" },
          requiresUserDecision: { type: "boolean" }
        },
        required: [
          "id",
          "description",
          "impact",
          "suggestedResolution",
          "requiresUserDecision"
        ]
      }
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          level: {
            type: "string",
            enum: ["low", "medium", "high", "critical"]
          },
          mitigation: { type: "string" }
        },
        required: ["id", "description", "level", "mitigation"]
      }
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          rationale: { type: "string" },
          impact: {
            type: "string",
            enum: ["low", "medium", "high"]
          }
        },
        required: ["id", "title", "description", "rationale", "impact"]
      }
    },
    architecture: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        frontend: { type: "string" },
        backend: { type: "string" },
        database: { type: "string" },
        infrastructure: { type: "string" },
        integrations: {
          type: "array",
          items: { type: "string" }
        },
        security: {
          type: "array",
          items: { type: "string" }
        },
        scalability: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: [
        "summary",
        "frontend",
        "backend",
        "database",
        "infrastructure",
        "integrations",
        "security",
        "scalability"
      ]
    },
    masterPlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          objective: { type: "string" },
          deliverables: {
            type: "array",
            items: { type: "string" }
          },
          dependencies: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["id", "name", "objective", "deliverables", "dependencies"]
      }
    },
    definitionOfDone: {
      type: "array",
      items: { type: "string" }
    },
    assumptions: {
      type: "array",
      items: { type: "string" }
    },
    requiresApproval: { type: "boolean" },
    generatedAt: { type: "string" }
  },
  required: [
    "projectName",
    "executiveSummary",
    "originalPrompt",
    "interpretedObjective",
    "requirements",
    "ambiguities",
    "risks",
    "recommendations",
    "architecture",
    "masterPlan",
    "definitionOfDone",
    "assumptions",
    "requiresApproval",
    "generatedAt"
  ]
};

export interface StrategicBrain {
  analyze(
    request: StrategicAnalysisRequest
  ): Promise<ProjectBlueprint>;
}
