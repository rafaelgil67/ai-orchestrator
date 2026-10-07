import { ProjectStateManager } from "../project-state/manager.js";
import type { ProjectState } from "../project-state/types.js";
import { PlanningService } from "../planning/planning-service.js";
import { ExecutionScheduler, ExecutionResult } from "../execution/contracts.js";
import { VerificationService } from "../verification/verification-service.js";
import {
  AutonomyConfig,
  AutonomyTrace,
  LoopDecision,
  LoopRunResult,
  LoopStepResult,
  LoopStoppedReason
} from "./contracts.js";
import {
  decideAfterExecution,
  decideAfterVerification
} from "./decision.js";
import {
  REPAIR_DEFAULTS,
  RepairDecisionService
} from "../repair/contracts.js";
import {
  DefaultRepairDecisionService,
  findingsSignature
} from "../repair/decision-service.js";
import {
  REPLAN_DEFAULTS,
  ReplanService
} from "../replanning/contracts.js";
import { DefaultReplanService } from "../replanning/replan-service.js";

const DEFAULT_MAX_CYCLES = 50;

/**
 * Autonomy Loop Engine — project lifecycle control engine.
 *
 *   ANALYZE → APPROVE → PLAN → EXECUTE → VERIFY → DECIDE → …
 *
 * step() performs exactly ONE valid transition according to the current
 * phase/status; run() iterates step() until a terminal decision or
 * maxCycles.
 *
 * Hard rules:
 *   · never auto-approves: a project in awaiting_approval stops the loop
 *     cleanly ("wait" decision) — the Approval Gate is never skipped;
 *   · never executes outside valid phases or on terminal projects
 *     (completed/failed);
 *   · a retry is only requested while retryCount < maxRetries; when
 *     exhausted, the task becomes "blocked" and the project "paused"
 *     (human intervention);
 *   · "verification" runs before any "completed";
 *   · "deployment" is out of the MVP scope: blocked terminal phase;
 *   · every step lands in project.autonomyTrace (integrated with
 *     attemptHistory data: taskId, agentId, attempt).
 */
export class AutonomyLoopEngine {
  constructor(
    private readonly stateManager: ProjectStateManager,
    private readonly planningService: PlanningService,
    private readonly scheduler: ExecutionScheduler,
    private readonly verificationService: VerificationService,
    private readonly repairDecisionService: RepairDecisionService =
      new DefaultRepairDecisionService(),
    private readonly maxRepairs: number =
      REPAIR_DEFAULTS.MAX_REPAIRS,
    private readonly replanService: ReplanService =
      new DefaultReplanService(stateManager),
    private maxReplans: number =
      REPLAN_DEFAULTS.MAX_REPLANS
  ) {}

  async step(projectId: string): Promise<LoopStepResult> {
    const project = this.stateManager.getProject(projectId);
    const cycle = (project.autonomyTrace?.length ?? 0) + 1;
    const phaseFrom = project.phase;

    const finish = (
      decision: LoopDecision,
      terminal: boolean,
      outcome: string,
      reason: string,
      extra?: { taskId?: string; agentId?: string; attempt?: number }
    ): LoopStepResult => {
      const state = this.stateManager.getProject(projectId);
      const trace: AutonomyTrace = {
        cycle,
        phaseFrom,
        phaseTo: state.phase,
        action: decision,
        taskId: extra?.taskId,
        agentId: extra?.agentId,
        attempt: extra?.attempt,
        outcome,
        reason,
        at: new Date().toISOString()
      };
      this.stateManager.appendAutonomyTrace(projectId, trace);
      return {
        projectId,
        decision,
        terminal,
        trace,
        project: this.stateManager.getProject(projectId)
      };
    };

    // ---- Terminal states: never resume without authorization ----
    if (project.status === "completed") {
      return finish("complete", true, "noop", "Project already completed.");
    }
    if (project.status === "failed") {
      return finish("fail", true, "noop", "Project is failed; resume requires human authorization.");
    }

    // ---- Approval Gate: NEVER skipped ----
    if (project.phase === "approval" || project.status === "awaiting_approval") {
      return finish("wait", true, "stopped", "Project is awaiting human approval; loop stopped cleanly.");
    }

    // ---- Pause/revision: human intervention required ----
    if (project.status === "paused" || project.phase === "revision") {
      return finish("block", true, "stopped", "Project is paused or awaiting revision; human intervention required.");
    }

    // ---- ANALYZE happens outside the loop (it creates the project). A
    // project still in discovery has no diagnosis: it cannot be planned ----
    if (project.phase === "discovery" || project.phase === "diagnosis") {
      return finish("block", true, "stopped", `Project requires strategic analysis before the loop can drive it (phase: ${project.phase}).`);
    }

    // ---- deployment is out of the MVP ----
    if (project.phase === "deployment") {
      return finish("block", true, "stopped", "Deployment phase is out of scope for the autonomy MVP.");
    }

    // ---- C3: the Approval Gate is verified, not inferred. Entering
    // planning/execution/verification requires an "approved" decision in
    // decisions[] — a state forced via updatePhase()/updateStatus()
    // without approval is blocked and paused, never executed ----
    if (
      (project.phase === "planning" ||
        project.phase === "execution" ||
        project.phase === "verification") &&
      !project.decisions.some(d => d.decision === "approved")
    ) {
      this.stateManager.updateStatus(projectId, "paused");
      return finish(
        "block",
        true,
        "blocked",
        "Approval Gate violated: project reached " +
          `${project.phase}/${project.status} without a recorded ` +
          `"approved" decision. Execution refused.`
      );
    }

    try {
      // ---- PLAN ----
      if (project.phase === "planning") {
        this.planningService.plan(projectId);
        return finish("continue", false, "planned", "Plan generated; project advanced to execution.");
      }

      // ---- EXECUTE ----
      if (project.phase === "execution") {
        const outcome = decideAfterExecution(project);

        if (outcome.decision === "retry" && outcome.retryTaskId) {
          const result = await this.scheduler.retryTask(projectId, outcome.retryTaskId);
          return this.traceExecution(
            finish, "retry", "retry_executed", outcome.reason, result
          );
        }

        if (outcome.decision === "block") {
          this.blockProject(project, outcome.reason);
          return finish("block", true, "blocked", outcome.reason);
        }

        const allCompleted =
          project.tasks.length > 0 &&
          project.tasks.every(task => task.status === "completed");

        if (allCompleted) {
          this.stateManager.updatePhase(projectId, "verification");
          return finish("continue", false, "phase_transition", outcome.reason);
        }

        const results = await this.scheduler.runNext(projectId);
        const last = results[results.length - 1];
        const executed = results.filter(r => r.success).length;
        return this.traceExecution(
          finish,
          "continue",
          `${executed}/${results.length} executed`,
          outcome.reason,
          last
        );
      }

      // ---- VERIFY ----
      if (project.phase === "verification") {
        const report = await this.verificationService.verify(projectId);
        const outcome = decideAfterVerification(report);

        if (outcome.decision === "complete") {
          this.stateManager.updatePhase(projectId, "completed");
          this.stateManager.updateStatus(projectId, "completed");
          return finish("complete", true, "completed", outcome.reason);
        }

        // Recovery Engine: a verification failure evaluates repair →
        // replan → block before failing. Conservative: when in doubt
        // → block (paused). M4: counters defensively sanitized.
        const repairCount = Number.isFinite(
          Number(project.metadata.repairCount)
        )
          ? Number(project.metadata.repairCount)
          : 0;
        const replanCount = Number.isFinite(
          Number(project.metadata.replanCount)
        )
          ? Number(project.metadata.replanCount)
          : 0;
        const previousSignature =
          project.metadata.lastFindingsSignature as
            | string
            | undefined;
        const signature = findingsSignature({
          report,
          project,
          repairCount,
          maxRepairs: this.maxRepairs,
          replanCount,
          maxReplans: this.maxReplans,
          previousSignature
        });
        const assessment = this.repairDecisionService.assess({
          report,
          project,
          repairCount,
          maxRepairs: this.maxRepairs,
          replanCount,
          maxReplans: this.maxReplans,
          previousSignature
        });

        // Always record the signature — no-progress detection depends
        // on comparing it in the next verification cycle.
        this.stateManager.setMetadata(
          projectId,
          "lastFindingsSignature",
          signature
        );

        if (assessment.decision === "repair") {
          // Reopen ONLY the affected tasks: status "ready" +
          // repairContext. attemptHistory and retryCount are kept
          // intact; completed tasks without findings are untouched.
          const repairCycle = repairCount + 1;
          for (const taskId of assessment.taskIds) {
            const task = project.tasks.find(
              item => item.id === taskId
            );
            this.stateManager.updateTask(projectId, taskId, {
              status: "ready",
              repairContext: {
                failedFindings:
                  report.taskVerifications.find(
                    v => v.taskId === taskId
                  )?.findings ?? [],
                repairCycle,
                previousAttemptSummaries:
                  task?.attemptHistory.map(a => a.summary) ?? [],
                reason: assessment.reason
              }
            });
          }
          this.stateManager.setMetadata(
            projectId,
            "repairCount",
            repairCycle
          );
          this.stateManager.updatePhase(projectId, "execution");
          // M1 — the reason keeps ALL affected taskIds, not just the
          // first one recorded in trace.taskId.
          return finish(
            "repair",
            false,
            "repair_scheduled",
            `${assessment.reason} ` +
              `[tasks: ${assessment.taskIds.join(", ")}]`,
            { taskId: assessment.taskIds[0] }
          );
        }

        // ---- REPLAN: the current plan is invalid; additive corrective
        // tasks are inserted. Completed tasks are NEVER touched; the new
        // tasks' deps only point to existing tasks ----
        if (assessment.decision === "replan") {
          const planInvalidFindings = report.taskVerifications
            .filter(v => !v.passed && v.kind === "plan_invalid")
            .flatMap(v =>
              v.findings.map(f => ({ taskId: v.taskId, finding: f }))
            );
          const result = this.replanService.replan({
            projectId,
            failedFindings: planInvalidFindings,
            preservedTaskIds: project.tasks
              .filter(t => t.status === "completed")
              .map(t => t.id),
            replanCycle: replanCount + 1,
            reason: assessment.reason
          });

          if (!result.success) {
            this.stateManager.updateStatus(projectId, "paused");
            return finish(
              "block",
              true,
              "blocked",
              `Replan refused: ${result.reason}`
            );
          }

          this.stateManager.setMetadata(
            projectId,
            "replanCount",
            replanCount + 1
          );
          this.stateManager.updatePhase(projectId, "execution");
          return finish(
            "replan",
            false,
            "replanned",
            `${assessment.reason} ` +
              `[added tasks: ${result.addedTaskIds.join(", ")}]`,
            { taskId: result.addedTaskIds[0] }
          );
        }

        if (assessment.decision === "fail") {
          this.stateManager.updatePhase(projectId, "failed");
          this.stateManager.updateStatus(projectId, "failed");
          return finish("fail", true, "failed", outcome.reason);
        }

        this.stateManager.updateStatus(projectId, "paused");
        return finish("block", true, "blocked", assessment.reason);
      }

      return finish("block", true, "stopped", `Unhandled phase/status combination: ${project.phase}/${project.status}.`);
    } catch (error) {
      // C1 — containment: any exception from plan/schedule/retry/verify
      // is traced, pauses the project and ends the cycle — the error is
      // not hidden and the next run() does not repeat the failed op.
      const reason =
        error instanceof Error ? error.message : String(error);
      try {
        this.stateManager.updateStatus(projectId, "paused");
      } catch {
        // if even the status cannot be updated, the trace still records it
      }
      return finish(
        "block",
        true,
        "error",
        `Step contained an error and the project was paused: ${reason}`
      );
    }
  }

  async run(
    projectId: string,
    config: AutonomyConfig = {}
  ): Promise<LoopRunResult> {
    const maxCycles = Math.max(1, config.maxCycles ?? DEFAULT_MAX_CYCLES);
    // AutonomyConfig.maxReplans can adjust the budget per run.
    if (config.maxReplans !== undefined) {
      this.maxReplans = config.maxReplans;
    }
    const decisions: LoopDecision[] = [];
    let cycles = 0;
    let stoppedReason: LoopStoppedReason = "max_cycles";

    while (cycles < maxCycles) {
      const step = await this.step(projectId);
      cycles += 1;
      decisions.push(step.decision);

      if (step.terminal) {
        stoppedReason = this.terminalReason(step.project, step.decision);
        break;
      }
    }

    return {
      projectId,
      cycles,
      stoppedReason,
      decisions,
      project: this.stateManager.getProject(projectId)
    };
  }

  private traceExecution(
    finish: (
      decision: LoopDecision,
      terminal: boolean,
      outcome: string,
      reason: string,
      extra?: { taskId?: string; agentId?: string; attempt?: number }
    ) => LoopStepResult,
    decision: LoopDecision,
    outcome: string,
    reason: string,
    result?: ExecutionResult
  ): LoopStepResult {
    return finish(decision, false, outcome, reason, result
      ? { taskId: result.taskId, agentId: result.agentId, attempt: result.attempt }
      : undefined);
  }

  /**
   * Clean blocking on the existing model: every failed task without
   * budget becomes "blocked" and the project "paused" (the same state
   * ApprovalGate.reject already uses) — never an infinite retry loop.
   */
  private blockProject(project: ProjectState, reason: string): void {
    for (const task of project.tasks) {
      if (task.status === "failed" && task.retryCount >= task.maxRetries) {
        this.stateManager.updateTask(project.id, task.id, {
          status: "blocked",
          lastFailureReason: task.lastFailureReason ?? reason
        });
      }
    }
    this.stateManager.updateStatus(project.id, "paused");
  }

  private terminalReason(
    project: ProjectState,
    decision: LoopDecision
  ): LoopStoppedReason {
    if (decision === "complete") return "completed";
    if (decision === "fail") return "failed";
    if (decision === "wait") return "awaiting_approval";
    if (project.status === "paused") return "paused";
    if (project.status === "failed") return "failed";
    return "blocked";
  }
}
