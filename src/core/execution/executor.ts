import {
  AgentRegistry
} from "../../agents/providers/agent-registry.js";

import {
  AgentTask,
  AgentResult
} from "../../agents/contracts/agent.js";

import {
  ProjectStateManager
} from "../project-state/manager.js";

import {
  ExecutionEngine,
  ExecutionResult,
  ExecutionTaskContext
} from "./contracts.js";

export class DefaultExecutionEngine implements ExecutionEngine {
  constructor(
    private readonly stateManager: ProjectStateManager,
    private readonly agentRegistry: AgentRegistry
  ) {}

  async executeTask(
    context: ExecutionTaskContext
  ): Promise<ExecutionResult> {
    const project = this.stateManager.getProject(
      context.projectId
    );

    const task = project.tasks.find(
      item => item.id === context.task.id
    );

    if (!task) {
      throw new Error(
        `Task not found in project: ${context.task.id}`
      );
    }

    if (
      task.status !== "pending" &&
      task.status !== "ready"
    ) {
      throw new Error(
        `Task is not executable: ${task.id}. ` +
        `Current status: ${task.status}`
      );
    }

    const retry =
      context.retry === true;

    if (retry && task.status !== "ready") {
      throw new Error(
        `Retry requires task to be ready: ${task.id}. ` +
        `Current status: ${task.status}`
      );
    }

    const agent = this.agentRegistry.select({
      capability: task.role as Parameters<
        AgentRegistry["select"]
      >[0]["capability"]
    });

    const nextAttempt =
      task.attempts + 1;

    this.stateManager.updateTask(
      context.projectId,
      task.id,
      {
        status: "running",
        assignedAgent: agent.id,
        attempts: nextAttempt,
        lastAttemptAt: new Date().toISOString()
      }
    );

    const agentTask: AgentTask = {
      id: task.id,
      projectId: context.projectId,
      title: task.title,
      description: task.description,
      capability:
        task.role as AgentTask["capability"],
      inputs: {
        projectId: context.projectId,
        project: project.brief,
        architecture: project.architecture,
        diagnosis: project.diagnosis,
        dependencyResults:
          task.dependsOn.map(
            dependencyId => {
              const dependency =
                project.tasks.find(
                  item =>
                    item.id === dependencyId
                );

              return {
                taskId: dependencyId,
                result: dependency?.result
              };
            }
          ),
        // Repair Engine MVP: transporte del contexto de reparación al
        // agente (indefinido cuando no aplica — comportamiento intacto).
        repairContext: task.repairContext
      },
      acceptanceCriteria:
        task.acceptanceCriteria ?? []
    };

    let result: AgentResult;

    try {
      result =
        await agent.execute(agentTask);
    } catch (error) {
      result = {
        success: false,
        summary:
          error instanceof Error
            ? error.message
            : "Unknown agent execution error",
        outputs: {},
        artifacts: [],
        issues: [
          error instanceof Error
            ? error.message
            : "Unknown agent execution error"
        ]
      };
    }

    const completedAt =
      new Date().toISOString();

    this.stateManager.updateTask(
      context.projectId,
      task.id,
      {
        status:
          result.success
            ? "completed"
            : "failed",

        result,

        lastFailureReason:
          result.success
            ? undefined
            : result.summary,

        lastAttemptAt:
          completedAt,

        retryCount:
          retry
            ? task.retryCount + 1
            : task.retryCount,

        attemptHistory: [
          ...task.attemptHistory,
          {
            attempt: nextAttempt,
            retry,
            agentId: agent.id,
            startedAt:
              task.lastAttemptAt ??
              completedAt,
            completedAt,
            success:
              result.success,
            summary:
              result.summary,
            result
          }
        ]
      }
    );

    return {
      projectId:
        context.projectId,
      taskId:
        task.id,
      agentId:
        agent.id,
      success:
        result.success,
      result,
      attempt:
        nextAttempt,
      retry
    };
  }
}
