import {
  AgentResult,
  AgentTask
} from "../../agents/contracts/agent.js";

import {
  ProjectTask
} from "../project-state/types.js";

export interface ExecutionTaskContext {
  projectId: string;
  task: ProjectTask;

  retry?: boolean;
}

export interface ExecutionResult {
  projectId: string;
  taskId: string;
  agentId: string;
  success: boolean;
  result: AgentResult;

  attempt: number;
  retry: boolean;
}

export interface ExecutionEngine {
  executeTask(
    context: ExecutionTaskContext
  ): Promise<ExecutionResult>;
}

export interface ExecutionScheduler {
  runNext(
    projectId: string
  ): Promise<ExecutionResult[]>;

  retryTask(
    projectId: string,
    taskId: string
  ): Promise<ExecutionResult>;
}
