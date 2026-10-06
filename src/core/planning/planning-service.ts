import { ProjectStateManager } from "../project-state/manager.js";
import { ProjectState } from "../project-state/types.js";
import { Planner } from "./planner.js";
import {
  PlanningRequest,
  PlanningResult
} from "./contracts.js";

export interface PlanningServiceResult {
  project: ProjectState;
  planning: PlanningResult;
}

export class PlanningService {
  constructor(
    private readonly stateManager: ProjectStateManager,
    private readonly planner: Planner
  ) {}

  plan(projectId: string): PlanningServiceResult {
    const project = this.stateManager.getProject(projectId);

    if (
      project.phase !== "planning" ||
      project.status !== "running"
    ) {
      throw new Error(
        `Project is not ready for planning. ` +
        `Current phase: ${project.phase}; status: ${project.status}`
      );
    }

    const blueprint = project.metadata.strategicBlueprint as {
      requirements?: Array<{
        description: string;
      }>;
      architecture?: unknown;
      definitionOfDone?: string[];
    } | undefined;

    if (!blueprint) {
      throw new Error(
        `Strategic blueprint not found for project: ${projectId}`
      );
    }

    const request: PlanningRequest = {
      projectId,
      projectName: project.brief.name,
      objective: project.brief.objective,
      requirements:
        blueprint.requirements?.map(
          requirement => requirement.description
        ) ?? [],
      architecture: project.architecture,
      definitionOfDone:
        blueprint.definitionOfDone ?? []
    };

    const planning = this.planner.plan(request);

    const taskIdMap = new Map<string, string>();

    for (const task of planning.tasks) {
      const createdTask = this.stateManager.addTask(projectId, {
        title: task.title,
        description: task.description,
        role: task.capability,
        status: task.status,
        dependsOn: [],
        acceptanceCriteria: task.acceptanceCriteria,
        attempts: 0,
        maxRetries: 2,
        retryCount: 0,
        assignedAgent: task.assignedAgentId,
        attemptHistory: []
      });

      taskIdMap.set(task.id, createdTask.id);
    }

    for (const task of planning.tasks) {
      const realTaskId = taskIdMap.get(task.id);

      if (!realTaskId) {
        throw new Error(
          `Unable to map planned task ID: ${task.id}`
        );
      }

      const realDependencies = task.dependsOn.map(
        dependencyId => {
          const realDependencyId =
            taskIdMap.get(dependencyId);

          if (!realDependencyId) {
            throw new Error(
              `Unable to map dependency ID: ${dependencyId} ` +
              `for planned task: ${task.id}`
            );
          }

          return realDependencyId;
        }
      );

      this.stateManager.updateTask(
        projectId,
        realTaskId,
        {
          dependsOn: realDependencies
        }
      );
    }

    this.stateManager.setMetadata(
      projectId,
      "planningResult",
      planning
    );

    this.stateManager.updatePhase(
      projectId,
      "execution"
    );

    return {
      project: this.stateManager.getProject(projectId),
      planning
    };
  }
}
