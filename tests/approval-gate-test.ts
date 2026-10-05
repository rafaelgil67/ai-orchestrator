import { ProjectStateManager } from "../src/core/project-state/manager.js";
import { ProjectApprovalGate } from "../src/core/governance/project-approval-gate.js";

const stateManager = new ProjectStateManager();
const gate = new ProjectApprovalGate(stateManager);

const approvedProject = stateManager.createProject({
  name: "Proyecto aprobado",
  objective: "Validar Approval Gate",
  originalPrompt: "Crear una aplicación profesional.",
  constraints: []
});

stateManager.updatePhase(
  approvedProject.id,
  "approval"
);

stateManager.updateStatus(
  approvedProject.id,
  "awaiting_approval"
);

const approval = gate.approve(
  approvedProject.id,
  "El diagnóstico cumple los criterios establecidos."
);

console.log("APPROVAL RESULT");
console.log(
  JSON.stringify(
    {
      phase: approval.project.phase,
      status: approval.project.status,
      approved: approval.approved,
      decisions: approval.project.decisions
    },
    null,
    2
  )
);

try {
  gate.approve(approvedProject.id);
  console.log("ERROR: second approval was accepted");
} catch (error) {
  console.log(
    "SECOND APPROVAL BLOCKED:",
    error instanceof Error ? error.message : String(error)
  );
}

const rejectedProject = stateManager.createProject({
  name: "Proyecto rechazado",
  objective: "Validar rechazo",
  originalPrompt: "Crear otra aplicación.",
  constraints: []
});

stateManager.updatePhase(
  rejectedProject.id,
  "approval"
);

stateManager.updateStatus(
  rejectedProject.id,
  "awaiting_approval"
);

const rejection = gate.reject(
  rejectedProject.id,
  "La especificación necesita mayor definición antes de continuar."
);

console.log("REJECTION RESULT");
console.log(
  JSON.stringify(
    {
      phase: rejection.project.phase,
      status: rejection.project.status,
      approved: rejection.approved,
      decisions: rejection.project.decisions
    },
    null,
    2
  )
);
