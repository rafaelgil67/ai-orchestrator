import { ProjectStateManager } from "../project-state/manager.js";
import { ProjectState } from "../project-state/types.js";
import {
  ApprovalGate,
  ApprovalResult
} from "./approval-gate.js";

export class ProjectApprovalGate implements ApprovalGate {
  constructor(
    private readonly stateManager: ProjectStateManager
  ) {}

  approve(
    projectId: string,
    rationale = "Project approved to continue with planning."
  ): ApprovalResult {
    const project = this.stateManager.getProject(projectId);

    this.assertAwaitingApproval(project);

    this.stateManager.addDecision(projectId, {
      title: "Project approval",
      decision: "approved",
      rationale
    });

    const updatedProject = this.stateManager.updatePhase(
      projectId,
      "planning"
    );

    this.stateManager.updateStatus(
      projectId,
      "running"
    );

    return {
      project: this.stateManager.getProject(updatedProject.id),
      approved: true
    };
  }

  reject(
    projectId: string,
    rationale = "The diagnosis requires review before continuing."
  ): ApprovalResult {
    const project = this.stateManager.getProject(projectId);

    this.assertAwaitingApproval(project);

    this.stateManager.addDecision(projectId, {
      title: "Project rejection",
      decision: "rejected",
      rationale
    });

    this.stateManager.updatePhase(
      projectId,
      "revision"
    );

    this.stateManager.updateStatus(
      projectId,
      "paused"
    );

    return {
      project: this.stateManager.getProject(projectId),
      approved: false
    };
  }

  private assertAwaitingApproval(
    project: ProjectState
  ): void {
    if (
      project.phase !== "approval" ||
      project.status !== "awaiting_approval"
    ) {
      throw new Error(
        `Project ${project.id} is not awaiting approval. ` +
        `Current phase: ${project.phase}; status: ${project.status}`
      );
    }
  }
}
