export type AgentCapability =
  | "requirements"
  | "architecture"
  | "coding"
  | "database"
  | "uiux"
  | "testing"
  | "security"
  | "devops"
  | "research"
  | "debugging"
  | "code-review";

export type AgentExecutionMode =
  | "synchronous"
  | "asynchronous"
  | "long_running";

export interface AgentTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  capability: AgentCapability;
  inputs: Record<string, unknown>;
  acceptanceCriteria: string[];
}

export interface AgentResult {
  success: boolean;
  summary: string;

  outputs: Record<string, unknown>;

  artifacts: string[];

  issues: string[];

  metadata?: Record<string, unknown>;
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly provider: string;

  capabilities: AgentCapability[];

  executionMode: AgentExecutionMode;

  canHandle(task: AgentTask): boolean;

  execute(task: AgentTask): Promise<AgentResult>;
}
