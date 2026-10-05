import { ProjectState } from "../project-state/types.js";

export interface ApprovalResult {
  project: ProjectState;
  approved: boolean;
}

export interface ApprovalGate {
  approve(
    projectId: string,
    rationale?: string
  ): ApprovalResult;

  reject(
    projectId: string,
    rationale?: string
  ): ApprovalResult;
}
