import {
  ProjectDecision,
  ProjectState,
  ProjectTask,
  ProjectBrief,
  ProjectPhase,
  ProjectStatus
} from "./types.js";

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

export class ProjectStateManager {
  private readonly projects = new Map<string, ProjectState>();

  createProject(brief: ProjectBrief): ProjectState {
    const timestamp = now();

    const state: ProjectState = {
      id: createId("project"),
      createdAt: timestamp,
      updatedAt: timestamp,

      phase: "discovery",
      status: "draft",

      brief,

      tasks: [],
      decisions: [],

      quality: {
        testsPassed: 0,
        testsFailed: 0,
        securityIssues: 0
      },

      metadata: {}
    };

    this.projects.set(state.id, state);

    return this.clone(state);
  }

  getProject(projectId: string): ProjectState {
    const state = this.projects.get(projectId);

    if (!state) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return this.clone(state);
  }

  updatePhase(projectId: string, phase: ProjectPhase): ProjectState {
    const state = this.requireProject(projectId);

    state.phase = phase;
    state.updatedAt = now();

    return this.clone(state);
  }

  updateStatus(projectId: string, status: ProjectStatus): ProjectState {
    const state = this.requireProject(projectId);

    state.status = status;
    state.updatedAt = now();

    return this.clone(state);
  }

  setDiagnosis(
    projectId: string,
    diagnosis: string,
    improvedSpecification?: string
  ): ProjectState {
    const state = this.requireProject(projectId);

    state.diagnosis = diagnosis;
    state.improvedSpecification = improvedSpecification;
    state.phase = "approval";
    state.status = "awaiting_approval";
    state.updatedAt = now();

    return this.clone(state);
  }

  setArchitecture(
    projectId: string,
    architecture: string
  ): ProjectState {
    const state = this.requireProject(projectId);

    state.architecture = architecture;
    state.updatedAt = now();

    return this.clone(state);
  }

  addTask(projectId: string, task: Omit<ProjectTask, "id">): ProjectTask {
    const state = this.requireProject(projectId);

    const createdTask: ProjectTask = {
      ...task,
      id: createId("task")
    };

    state.tasks.push(createdTask);
    state.updatedAt = now();

    return { ...createdTask };
  }

  updateTask(
    projectId: string,
    taskId: string,
    patch: Partial<ProjectTask>
  ): ProjectTask {
    const state = this.requireProject(projectId);
    const task = state.tasks.find(item => item.id === taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    Object.assign(task, patch);
    state.updatedAt = now();

    return { ...task };
  }

  addDecision(
    projectId: string,
    decision: Omit<ProjectDecision, "id" | "createdAt">
  ): ProjectDecision {
    const state = this.requireProject(projectId);

    const createdDecision: ProjectDecision = {
      ...decision,
      id: createId("decision"),
      createdAt: now()
    };

    state.decisions.push(createdDecision);
    state.updatedAt = now();

    return { ...createdDecision };
  }

  setActiveAgent(
    projectId: string,
    agentId?: string
  ): ProjectState {
    const state = this.requireProject(projectId);

    state.activeAgent = agentId;
    state.updatedAt = now();

    return this.clone(state);
  }

  updateQuality(
    projectId: string,
    quality: Partial<ProjectState["quality"]>
  ): ProjectState {
    const state = this.requireProject(projectId);

    state.quality = {
      ...state.quality,
      ...quality
    };

    state.updatedAt = now();

    return this.clone(state);
  }

  setMetadata(
    projectId: string,
    key: string,
    value: unknown
  ): ProjectState {
    const state = this.requireProject(projectId);

    state.metadata[key] = value;
    state.updatedAt = now();

    return this.clone(state);
  }

  listProjects(): ProjectState[] {
    return Array.from(this.projects.values()).map(state =>
      this.clone(state)
    );
  }

  private requireProject(projectId: string): ProjectState {
    const state = this.projects.get(projectId);

    if (!state) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return state;
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
