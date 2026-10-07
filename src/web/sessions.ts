/**
 * DemoSessionService — the session boundary between HTTP transport and
 * the core engine.
 *
 *   1 sessionId → 1 fully independent core stack → 1 project
 *
 * Each session owns its own ProjectStateManager and AutonomyLoopEngine,
 * so two concurrent demos can never contaminate each other. Sessions are
 * ephemeral and in-memory only: they expire after a TTL and are lost on
 * restart. No persistence by design.
 *
 * The autonomy loop is driven step-by-step (engine.step()) so the SSE
 * stream can emit real progress between cycles. `running` is the session
 * mutex: two engine.step() calls on the same session can never overlap.
 */
import type { ServerResponse } from "node:http";
import { ProjectStateManager } from "../core/project-state/manager.js";
import type { ProjectState } from "../core/project-state/types.js";
import { StrategicAnalysisService } from "../core/strategy/service.js";
import { StrategicBrainEngine } from "../core/strategy/engine.js";
import { BlueprintValidator } from "../core/strategy/validator.js";
import { ProjectApprovalGate } from "../core/governance/project-approval-gate.js";
import { PlanningService } from "../core/planning/planning-service.js";
import { Planner } from "../core/planning/planner.js";
import { AgentRegistry } from "../agents/providers/agent-registry.js";
import { MockAIProvider } from "../agents/providers/mock-provider.js";
import { MockAgent } from "../agents/providers/mock-agent.js";
import { DefaultExecutionEngine } from "../core/execution/executor.js";
import { DefaultExecutionScheduler } from "../core/execution/scheduler.js";
import { VerificationService } from "../core/verification/verification-service.js";
import { AutonomyLoopEngine } from "../core/autonomy/autonomy-engine.js";
import { ApiError } from "./errors.js";
import { serializeProject, SessionDTO } from "./dto.js";

export interface SessionConfig {
  maxSessions: number;
  ttlMs: number;
  /** Pause between engine steps — keeps the demo visually readable. */
  stepDelayMs: number;
  maxCycles: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxSessions: 10,
  ttlMs: 30 * 60 * 1000,
  stepDelayMs: 400,
  maxCycles: 50
};

export interface CoreStack {
  stateManager: ProjectStateManager;
  strategicService: StrategicAnalysisService;
  approvalGate: ProjectApprovalGate;
  engine: AutonomyLoopEngine;
}

export interface DemoSession {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  stack: CoreStack;
  projectId?: string;
  running: boolean;
  stoppedReason?: string;
  listeners: Set<ServerResponse>;
}

export type DemoEventType =
  | "state"
  | "trace"
  | "task"
  | "phase"
  | "decision"
  | "done";

function createSessionId(): string {
  return `demo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Composes a complete, isolated core stack for one demo session. */
export function buildCoreStack(): CoreStack {
  const stateManager = new ProjectStateManager();
  const strategicService = new StrategicAnalysisService(
    stateManager,
    new StrategicBrainEngine(new MockAIProvider(), new BlueprintValidator())
  );
  const approvalGate = new ProjectApprovalGate(stateManager);
  const planningService = new PlanningService(stateManager, new Planner());
  const agentRegistry = new AgentRegistry();
  agentRegistry.register(new MockAgent());
  const scheduler = new DefaultExecutionScheduler(
    stateManager,
    new DefaultExecutionEngine(stateManager, agentRegistry)
  );
  const verificationService = new VerificationService(stateManager);
  const engine = new AutonomyLoopEngine(
    stateManager,
    planningService,
    scheduler,
    verificationService
  );
  return { stateManager, strategicService, approvalGate, engine };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class DemoSessionService {
  private readonly sessions = new Map<string, DemoSession>();
  private readonly cleanupTimer: ReturnType<typeof setInterval> &
    { unref?: () => void };

  constructor(
    private readonly config: SessionConfig = DEFAULT_SESSION_CONFIG
  ) {
    this.cleanupTimer = setInterval(
      () => this.expireStale(),
      60 * 1000
    );
    // Never keep the process alive just for cleanup.
    this.cleanupTimer.unref?.();
  }

  async create(
    brief: string,
    projectName?: string
  ): Promise<DemoSession> {
    this.expireStale();
    if (this.sessions.size >= this.config.maxSessions) {
      throw new ApiError(
        429,
        "session_capacity_reached",
        "Demo capacity reached; please try again later."
      );
    }

    const session: DemoSession = {
      id: createSessionId(),
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      stack: buildCoreStack(),
      running: false,
      listeners: new Set()
    };

    const { project } = await session.stack.strategicService.analyze({
      projectName,
      prompt: brief
    });
    session.projectId = project.id;
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string): DemoSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ApiError(404, "session_not_found", "Demo session not found or expired.");
    }
    session.lastActivityAt = Date.now();
    return session;
  }

  project(session: DemoSession): ProjectState {
    if (!session.projectId) {
      throw new ApiError(404, "not_found", "Session has no project yet.");
    }
    return session.stack.stateManager.getProject(session.projectId);
  }

  serialize(session: DemoSession): SessionDTO {
    return {
      sessionId: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
      running: session.running,
      stoppedReason: session.stoppedReason,
      project: serializeProject(this.project(session))
    };
  }

  approve(session: DemoSession, rationale?: string): void {
    const project = this.project(session);
    if (project.status !== "awaiting_approval") {
      throw new ApiError(
        409,
        "invalid_state_transition",
        "The demo is not awaiting approval."
      );
    }
    session.stack.approvalGate.approve(session.projectId!, rationale);
    this.emit(session, "decision", {
      kind: "approved",
      rationale: rationale ?? null
    });
    this.emitState(session);
  }

  reject(session: DemoSession, rationale?: string): void {
    const project = this.project(session);
    if (project.status !== "awaiting_approval") {
      throw new ApiError(
        409,
        "invalid_state_transition",
        "The demo is not awaiting approval."
      );
    }
    session.stack.approvalGate.reject(session.projectId!, rationale);
    this.emit(session, "decision", {
      kind: "rejected",
      rationale: rationale ?? null
    });
    this.emitState(session);
  }

  /**
   * Starts the step-driven autonomy loop in the background. Returns
   * immediately; progress flows through SSE events. The `running` flag
   * is the session mutex — a second run while active is rejected.
   */
  run(session: DemoSession): void {
    const project = this.project(session);

    if (session.running) {
      throw new ApiError(
        409,
        "execution_in_progress",
        "The demo execution is already in progress."
      );
    }
    if (project.status === "awaiting_approval") {
      throw new ApiError(
        409,
        "approval_required",
        "Human approval is required before execution."
      );
    }
    if (
      project.status === "completed" ||
      project.status === "failed" ||
      project.status === "paused"
    ) {
      throw new ApiError(
        409,
        "invalid_state_transition",
        `The demo is in a terminal state (${project.status}).`
      );
    }

    session.running = true;
    this.emitState(session);
    void this.executeLoop(session).catch(error => {
      // Containment: never let the loop crash the process.
      console.error(
        `[demo] execution loop error in session ${session.id}:`,
        error instanceof Error ? error.message : error
      );
    }).finally(() => {
      session.running = false;
      this.emitState(session);
    });
  }

  private async executeLoop(session: DemoSession): Promise<void> {
    const { engine } = session.stack;
    let cycles = 0;
    let previousPhase = this.project(session).phase;

    while (cycles < this.config.maxCycles) {
      if (!this.sessions.has(session.id)) {
        return; // session expired mid-run
      }

      const before = this.project(session);
      const step = await engine.step(session.projectId!);
      cycles += 1;
      const after = step.project;

      this.emit(session, "trace", { entry: step.trace });
      if (after.phase !== previousPhase) {
        this.emit(session, "phase", {
          from: previousPhase,
          to: after.phase,
          cycle: step.trace.cycle
        });
        previousPhase = after.phase;
      }
      this.emitTaskDiffs(session, before, after);
      this.emitState(session);

      if (step.terminal) {
        session.stoppedReason = this.stoppedReason(step.decision, after);
        this.emit(session, "done", {
          stoppedReason: session.stoppedReason,
          cycles,
          decision: step.decision
        });
        return;
      }

      await sleep(this.config.stepDelayMs);
    }

    session.stoppedReason = "max_cycles";
    this.emit(session, "done", {
      stoppedReason: "max_cycles",
      cycles,
      decision: "block"
    });
  }

  private stoppedReason(
    decision: string,
    project: ProjectState
  ): string {
    if (decision === "complete") return "completed";
    if (decision === "fail") return "failed";
    if (decision === "wait") return "awaiting_approval";
    if (project.status === "paused") return "paused";
    if (project.status === "failed") return "failed";
    return "blocked";
  }

  private emitTaskDiffs(
    session: DemoSession,
    before: ProjectState,
    after: ProjectState
  ): void {
    for (const task of after.tasks) {
      const prev = before.tasks.find(item => item.id === task.id);
      if (!prev) {
        this.emit(session, "task", {
          taskId: task.id,
          title: task.title,
          status: task.status,
          created: true
        });
        continue;
      }
      if (
        prev.status !== task.status ||
        prev.attempts !== task.attempts ||
        prev.retryCount !== task.retryCount
      ) {
        this.emit(session, "task", {
          taskId: task.id,
          title: task.title,
          status: task.status,
          attempt: task.attempts,
          retryCount: task.retryCount,
          agentId: task.assignedAgent
        });
      }
    }
  }

  /** Registers an SSE listener; the response stays open until close. */
  subscribe(sessionId: string, res: ServerResponse): void {
    const session = this.get(sessionId);
    session.listeners.add(res);
    res.on("close", () => session.listeners.delete(res));

    // Catch-up: current state + full trace so late joiners see everything.
    this.send(res, "state", { session: this.serialize(session) });
    for (const entry of this.project(session).autonomyTrace ?? []) {
      this.send(res, "trace", { entry });
    }
    if (session.stoppedReason) {
      this.send(res, "done", {
        stoppedReason: session.stoppedReason,
        cycles: this.project(session).autonomyTrace?.length ?? 0
      });
    }
  }

  emit(session: DemoSession, type: DemoEventType, data: unknown): void {
    for (const res of session.listeners) {
      this.send(res, type, data);
    }
  }

  private emitState(session: DemoSession): void {
    this.emit(session, "state", { session: this.serialize(session) });
  }

  private send(
    res: ServerResponse,
    type: DemoEventType,
    data: unknown
  ): void {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  expireStale(now: number = Date.now()): number {
    let expired = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > this.config.ttlMs) {
        for (const res of session.listeners) {
          if (!res.writableEnded) {
            res.end();
          }
        }
        session.listeners.clear();
        this.sessions.delete(id);
        expired += 1;
      }
    }
    return expired;
  }

  get size(): number {
    return this.sessions.size;
  }
}
