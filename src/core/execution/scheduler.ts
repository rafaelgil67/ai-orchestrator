import {
  ExecutionResult,
  ExecutionScheduler
} from "./contracts.js";

import {
  DefaultExecutionEngine
} from "./executor.js";

import {
  ProjectStateManager
} from "../project-state/manager.js";

export class DefaultExecutionScheduler
  implements ExecutionScheduler {

  constructor(
    private readonly stateManager: ProjectStateManager,
    private readonly executionEngine: DefaultExecutionEngine
  ) {}

  async runNext(
    projectId: string
  ): Promise<ExecutionResult[]> {
    const project =
      this.stateManager.getProject(projectId);

    const executableTasks =
      project.tasks.filter(task => {
        if (
          task.status !== "pending" &&
          task.status !== "ready"
        ) {
          return false;
        }

        return task.dependsOn.every(
          dependencyId => {
            const dependency =
              project.tasks.find(
                task =>
                  task.id === dependencyId
              );

            return (
              dependency?.status ===
              "completed"
            );
          }
        );
      });

    const results: ExecutionResult[] = [];

    for (const task of executableTasks) {
      const result =
        await this.executionEngine.executeTask({
          projectId,
          task,
          retry: false
        });

      results.push(result);

      if (!result.success) {
        break;
      }
    }

    return results;
  }

  async retryTask(
    projectId: string,
    taskId: string
  ): Promise<ExecutionResult> {
    const project =
      this.stateManager.getProject(projectId);

    const task =
      project.tasks.find(
        item => item.id === taskId
      );

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    if (task.status !== "failed") {
      throw new Error(
        `Task is not eligible for retry: ${taskId}. ` +
        `Current status: ${task.status}`
      );
    }

    if (
      task.retryCount >=
      task.maxRetries
    ) {
      throw new Error(
        `Retry limit reached for task: ${taskId}. ` +
        `maxRetries=${task.maxRetries}`
      );
    }

    const retryNumber =
      task.retryCount + 1;

    this.stateManager.updateTask(
      projectId,
      taskId,
      {
        status: "ready"
      }
    );

    try {
      return await this.executionEngine.executeTask({
        projectId,
        task: {
          ...task,
          status: "ready"
        },
        retry: true
      });
    } catch (error) {
      this.stateManager.updateTask(
        projectId,
        taskId,
        {
          status: "failed",
          lastFailureReason:
            error instanceof Error
              ? error.message
              : "Unknown retry error"
        }
      );

      throw new Error(
        `Retry ${retryNumber} failed to execute for task ${taskId}: ` +
        `${
          error instanceof Error
            ? error.message
            : "Unknown error"
        }`
      );
    }
  }
}
