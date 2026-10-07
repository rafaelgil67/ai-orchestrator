import {
  PlanningRequest,
  PlanningResult,
  PlannedTask
} from "./contracts.js";

import { TaskGraph } from "./task-graph.js";

export class Planner {
  plan(request: PlanningRequest): PlanningResult {
    const graph = new TaskGraph();

    const tasks: PlannedTask[] = [
      {
        id: "PLAN-001",
        projectId: request.projectId,
        title: "Analyze functional requirements",
        description:
          "Turn the provided requirements into verifiable functional specifications.",
        capability: "requirements",
        status: "pending",
        dependsOn: [],
        acceptanceCriteria: [
          "All mandatory requirements are identified.",
          "Every requirement has acceptance criteria.",
          "No critical ambiguities remain unresolved."
        ],
        inputs: {
          requirements: request.requirements
        },
        priority: "critical"
      },

      {
        id: "PLAN-002",
        projectId: request.projectId,
        title: "Define technical architecture",
        description:
          "Design the solution's technical architecture from the validated requirements.",
        capability: "architecture",
        status: "pending",
        dependsOn: ["PLAN-001"],
        acceptanceCriteria: [
          "The architecture covers frontend, backend, data and infrastructure.",
          "Required integrations are identified.",
          "Major technical risks are addressed."
        ],
        inputs: {
          objective: request.objective,
          architecture: request.architecture
        },
        priority: "critical"
      },

      {
        id: "PLAN-003",
        projectId: request.projectId,
        title: "Design data model",
        description:
          "Design the persistence structures needed to implement the solution.",
        capability: "database",
        status: "pending",
        dependsOn: ["PLAN-002"],
        acceptanceCriteria: [
          "The main entities are identified.",
          "Relationships are consistent.",
          "The structure supports the functional requirements."
        ],
        inputs: {
          objective: request.objective
        },
        priority: "high"
      },

      {
        id: "PLAN-004",
        projectId: request.projectId,
        title: "Design experience and interface",
        description:
          "Define the user experience and interface required for the solution.",
        capability: "uiux",
        status: "pending",
        dependsOn: ["PLAN-002"],
        acceptanceCriteria: [
          "The main flows are defined.",
          "The interface covers the core features.",
          "The experience is consistent and usable."
        ],
        inputs: {
          objective: request.objective
        },
        priority: "high"
      },

      {
        id: "PLAN-005",
        projectId: request.projectId,
        title: "Implement solution",
        description:
          "Build the application following the approved architecture, data model and design.",
        capability: "coding",
        status: "pending",
        dependsOn: [
          "PLAN-003",
          "PLAN-004"
        ],
        acceptanceCriteria: [
          "The application compiles correctly.",
          "Required features are implemented.",
          "The implementation follows the defined architecture."
        ],
        inputs: {
          objective: request.objective
        },
        priority: "critical"
      },

      {
        id: "PLAN-006",
        projectId: request.projectId,
        title: "Run tests and QA",
        description:
          "Verify functionality, regressions and acceptance criteria compliance.",
        capability: "testing",
        status: "pending",
        dependsOn: ["PLAN-005"],
        acceptanceCriteria: [
          "Critical tests pass.",
          "No known critical regressions exist.",
          "Acceptance criteria are met."
        ],
        inputs: {
          definitionOfDone: request.definitionOfDone
        },
        priority: "critical"
      },

      {
        id: "PLAN-007",
        projectId: request.projectId,
        title: "Audit security",
        description:
          "Analyze the solution for vulnerabilities and configuration issues.",
        capability: "security",
        status: "pending",
        dependsOn: ["PLAN-005"],
        acceptanceCriteria: [
          "No known critical vulnerabilities exist.",
          "Credentials and secrets are protected.",
          "Access controls are adequate."
        ],
        inputs: {},
        priority: "critical"
      },

      {
        id: "PLAN-008",
        projectId: request.projectId,
        title: "Prepare deployment",
        description:
          "Prepare the solution for execution or deployment in the target environment.",
        capability: "devops",
        status: "pending",
        dependsOn: [
          "PLAN-006",
          "PLAN-007"
        ],
        acceptanceCriteria: [
          "The deployment process is defined.",
          "The application can run in the target environment.",
          "Final verifications are documented."
        ],
        inputs: {},
        priority: "high"
      }
    ];

    graph.addTasks(tasks);

    const executionOrder = this.calculateExecutionOrder(graph);

    return {
      projectId: request.projectId,
      tasks: graph.listTasks(),
      executionOrder,
      summary:
        `Plan generated with ${tasks.length} tasks and ` +
        `${executionOrder.length} execution slots.`
    };
  }

  private calculateExecutionOrder(
    graph: TaskGraph
  ): string[] {
    const tasks = graph.listTasks();
    const completed = new Set<string>();
    const order: string[] = [];

    while (completed.size < tasks.length) {
      const available = tasks.filter(task =>
        !completed.has(task.id) &&
        task.dependsOn.every(
          dependency => completed.has(dependency)
        )
      );

      if (available.length === 0) {
        throw new Error(
          "Unable to calculate execution order. " +
          "The planning graph contains an unresolved dependency."
        );
      }

      for (const task of available) {
        order.push(task.id);
        completed.add(task.id);
      }
    }

    return order;
  }
}
