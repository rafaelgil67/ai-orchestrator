import {
  PlannedTask,
  PlanningTaskStatus
} from "./contracts.js";

export class TaskGraph {
  private readonly tasks = new Map<string, PlannedTask>();

  addTask(task: PlannedTask): void {
    if (this.tasks.has(task.id)) {
      throw new Error(`Task already exists: ${task.id}`);
    }

    for (const dependency of task.dependsOn) {
      if (dependency === task.id) {
        throw new Error(
          `Task cannot depend on itself: ${task.id}`
        );
      }
    }

    this.tasks.set(task.id, {
      ...task,
      dependsOn: [...task.dependsOn]
    });
  }

  addTasks(tasks: PlannedTask[]): void {
    for (const task of tasks) {
      this.addTask(task);
    }

    this.validateDependencies();
  }

  getTask(taskId: string): PlannedTask {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    return this.clone(task);
  }

  listTasks(): PlannedTask[] {
    return Array.from(this.tasks.values()).map(task =>
      this.clone(task)
    );
  }

  getReadyTasks(): PlannedTask[] {
    return this.listTasks().filter(task => {
      if (task.status !== "pending") {
        return false;
      }

      return task.dependsOn.every(dependencyId => {
        const dependency = this.tasks.get(dependencyId);

        return dependency?.status === "completed";
      });
    });
  }

  updateStatus(
    taskId: string,
    status: PlanningTaskStatus
  ): PlannedTask {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = status;

    return this.clone(task);
  }

  isComplete(): boolean {
    const tasks = this.listTasks();

    return tasks.length > 0 &&
      tasks.every(task => task.status === "completed");
  }

  hasFailed(): boolean {
    return this.listTasks().some(
      task => task.status === "failed"
    );
  }

  validateDependencies(): void {
    for (const task of this.tasks.values()) {
      for (const dependencyId of task.dependsOn) {
        if (!this.tasks.has(dependencyId)) {
          throw new Error(
            `Missing dependency "${dependencyId}" for task "${task.id}"`
          );
        }
      }
    }

    this.detectCycles();
  }

  private detectCycles(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (taskId: string): void => {
      if (visiting.has(taskId)) {
        throw new Error(
          `Circular dependency detected involving task: ${taskId}`
        );
      }

      if (visited.has(taskId)) {
        return;
      }

      visiting.add(taskId);

      const task = this.tasks.get(taskId);

      if (!task) {
        return;
      }

      for (const dependencyId of task.dependsOn) {
        visit(dependencyId);
      }

      visiting.delete(taskId);
      visited.add(taskId);
    };

    for (const taskId of this.tasks.keys()) {
      visit(taskId);
    }
  }

  private clone(task: PlannedTask): PlannedTask {
    return structuredClone(task);
  }
}
