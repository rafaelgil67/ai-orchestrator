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
        title: "Analizar requisitos funcionales",
        description:
          "Convertir los requisitos proporcionados en especificaciones funcionales verificables.",
        capability: "requirements",
        status: "pending",
        dependsOn: [],
        acceptanceCriteria: [
          "Todos los requisitos obligatorios están identificados.",
          "Cada requisito tiene criterios de aceptación.",
          "No existen ambigüedades críticas sin resolver."
        ],
        inputs: {
          requirements: request.requirements
        },
        priority: "critical"
      },

      {
        id: "PLAN-002",
        projectId: request.projectId,
        title: "Definir arquitectura técnica",
        description:
          "Diseñar la arquitectura técnica de la solución a partir de los requisitos validados.",
        capability: "architecture",
        status: "pending",
        dependsOn: ["PLAN-001"],
        acceptanceCriteria: [
          "La arquitectura cubre frontend, backend, datos e infraestructura.",
          "Las integraciones necesarias están identificadas.",
          "Los principales riesgos técnicos están contemplados."
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
        title: "Diseñar modelo de datos",
        description:
          "Diseñar las estructuras de persistencia necesarias para implementar la solución.",
        capability: "database",
        status: "pending",
        dependsOn: ["PLAN-002"],
        acceptanceCriteria: [
          "Las entidades principales están identificadas.",
          "Las relaciones son coherentes.",
          "La estructura soporta los requisitos funcionales."
        ],
        inputs: {
          objective: request.objective
        },
        priority: "high"
      },

      {
        id: "PLAN-004",
        projectId: request.projectId,
        title: "Diseñar experiencia e interfaz",
        description:
          "Definir la experiencia de usuario y la interfaz necesarias para la solución.",
        capability: "uiux",
        status: "pending",
        dependsOn: ["PLAN-002"],
        acceptanceCriteria: [
          "Los flujos principales están definidos.",
          "La interfaz cubre las funciones principales.",
          "La experiencia es coherente y usable."
        ],
        inputs: {
          objective: request.objective
        },
        priority: "high"
      },

      {
        id: "PLAN-005",
        projectId: request.projectId,
        title: "Implementar solución",
        description:
          "Construir la aplicación siguiendo la arquitectura, modelo de datos y diseño aprobados.",
        capability: "coding",
        status: "pending",
        dependsOn: [
          "PLAN-003",
          "PLAN-004"
        ],
        acceptanceCriteria: [
          "La aplicación compila correctamente.",
          "Las funcionalidades requeridas están implementadas.",
          "La implementación respeta la arquitectura definida."
        ],
        inputs: {
          objective: request.objective
        },
        priority: "critical"
      },

      {
        id: "PLAN-006",
        projectId: request.projectId,
        title: "Ejecutar pruebas y QA",
        description:
          "Verificar funcionalidad, regresiones y cumplimiento de criterios de aceptación.",
        capability: "testing",
        status: "pending",
        dependsOn: ["PLAN-005"],
        acceptanceCriteria: [
          "Las pruebas críticas pasan.",
          "No existen regresiones críticas conocidas.",
          "Los criterios de aceptación se cumplen."
        ],
        inputs: {
          definitionOfDone: request.definitionOfDone
        },
        priority: "critical"
      },

      {
        id: "PLAN-007",
        projectId: request.projectId,
        title: "Auditar seguridad",
        description:
          "Analizar la solución en busca de vulnerabilidades y problemas de configuración.",
        capability: "security",
        status: "pending",
        dependsOn: ["PLAN-005"],
        acceptanceCriteria: [
          "No existen vulnerabilidades críticas conocidas.",
          "Las credenciales y secretos están protegidos.",
          "Los controles de acceso son adecuados."
        ],
        inputs: {},
        priority: "critical"
      },

      {
        id: "PLAN-008",
        projectId: request.projectId,
        title: "Preparar despliegue",
        description:
          "Preparar la solución para su ejecución o despliegue en el entorno objetivo.",
        capability: "devops",
        status: "pending",
        dependsOn: [
          "PLAN-006",
          "PLAN-007"
        ],
        acceptanceCriteria: [
          "El proceso de despliegue está definido.",
          "La aplicación puede ejecutarse en el entorno objetivo.",
          "Las verificaciones finales están documentadas."
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
        `Plan generado con ${tasks.length} tareas y ` +
        `${executionOrder.length} posiciones de ejecución.`
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
