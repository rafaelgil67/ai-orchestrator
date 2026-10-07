import { ProjectStateManager } from "../project-state/manager.js";
import { ProjectTask } from "../project-state/types.js";
import {
  TaskVerification,
  TaskVerifier,
  VerificationReport
} from "./contracts.js";

/**
 * Default verifier: a task passes if it finished "completed" with a
 * successful AgentResult and no reported issues. Deliberately
 * conservative — it can be replaced by a real QA agent by injecting
 * another TaskVerifier without touching the service or the engine.
 */
class DefaultTaskVerifier implements TaskVerifier {
  verifyTask(task: ProjectTask): TaskVerification {
    const findings: string[] = [];

    if (task.status !== "completed") {
      findings.push(`Task did not complete (status: ${task.status}).`);
    }
    if (task.result && task.result.success !== true) {
      findings.push("Agent result was not successful.");
    }
    if (task.result && task.result.issues.length > 0) {
      findings.push(
        `Agent reported ${task.result.issues.length} issue(s).`
      );
    }

    return {
      taskId: task.id,
      passed: findings.length === 0,
      findings
    };
  }
}

export class VerificationService {
  private readonly verifier: TaskVerifier;

  constructor(
    private readonly stateManager: ProjectStateManager,
    verifier?: TaskVerifier
  ) {
    this.verifier = verifier ?? new DefaultTaskVerifier();
  }

  async verify(projectId: string): Promise<VerificationReport> {
    const project = this.stateManager.getProject(projectId);

    const taskVerifications: TaskVerification[] = [];
    for (const task of project.tasks) {
      taskVerifications.push(await this.verifier.verifyTask(task));
    }

    const findings = taskVerifications
      .filter(item => !item.passed)
      .flatMap(item =>
        item.findings.map(finding => `${item.taskId}: ${finding}`)
      );

    const report: VerificationReport = {
      projectId,
      passed:
        project.tasks.length > 0 &&
        taskVerifications.every(item => item.passed),
      taskVerifications,
      findings,
      verifiedAt: new Date().toISOString()
    };

    this.stateManager.setMetadata(
      projectId,
      "verificationReport",
      report
    );

    return report;
  }
}
