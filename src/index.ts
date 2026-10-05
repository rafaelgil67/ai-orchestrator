/**
 * AI Orchestrator — MVP foundation
 *
 * The orchestrator receives a project brief, creates a plan, delegates
 * tasks to specialized agents, and verifies their results.
 *
 * No external provider is hard-coded yet. Devin, OpenAI, Claude or other
 * agents will be connected through adapters in a later phase.
 */

type AgentRole =
  | "product"
  | "architect"
  | "developer"
  | "database"
  | "uiux"
  | "qa"
  | "security"
  | "devops";

type TaskStatus = "pending" | "running" | "blocked" | "completed" | "failed";

interface ProjectBrief {
  name: string;
  objective: string;
  constraints: string[];
}

interface Task {
  id: string;
  title: string;
  role: AgentRole;
  status: TaskStatus;
  dependsOn: string[];
}

interface ProjectState {
  brief: ProjectBrief;
  tasks: Task[];
  decisions: string[];
}

class Orchestrator {
  createPlan(brief: ProjectBrief): ProjectState {
    const tasks: Task[] = [
      { id: "T01", title: "Analizar requerimientos", role: "product", status: "pending", dependsOn: [] },
      { id: "T02", title: "Diseñar arquitectura", role: "architect", status: "pending", dependsOn: ["T01"] },
      { id: "T03", title: "Diseñar base de datos", role: "database", status: "pending", dependsOn: ["T02"] },
      { id: "T04", title: "Diseñar UX/UI", role: "uiux", status: "pending", dependsOn: ["T02"] },
      { id: "T05", title: "Implementar aplicación", role: "developer", status: "pending", dependsOn: ["T03", "T04"] },
      { id: "T06", title: "Ejecutar QA y pruebas", role: "qa", status: "pending", dependsOn: ["T05"] },
      { id: "T07", title: "Auditar seguridad", role: "security", status: "pending", dependsOn: ["T05"] },
      { id: "T08", title: "Preparar despliegue", role: "devops", status: "pending", dependsOn: ["T06", "T07"] }
    ];

    return {
      brief,
      tasks,
      decisions: []
    };
  }

  nextTasks(state: ProjectState): Task[] {
    return state.tasks.filter(task =>
      task.status === "pending" &&
      task.dependsOn.every(id => state.tasks.find(t => t.id === id)?.status === "completed")
    );
  }
}

const brief: ProjectBrief = {
  name: "AI Software Factory",
  objective: "Crear un orquestador autónomo que reciba un brief inicial y coordine agentes especializados para construir aplicaciones.",
  constraints: [
    "Proyecto independiente de AsegurApp y SR Asesores.",
    "Devin se integrará como agente ejecutor de desarrollo mediante un adaptador.",
    "Acciones sensibles requerirán políticas explícitas de autorización."
  ]
};

const orchestrator = new Orchestrator();
const state = orchestrator.createPlan(brief);

console.log(JSON.stringify({
  project: state.brief.name,
  firstTasks: orchestrator.nextTasks(state)
}, null, 2));
