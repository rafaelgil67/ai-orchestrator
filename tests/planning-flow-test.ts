import { ProjectStateManager } from "../src/core/project-state/manager.js";
import { StrategicAnalysisService } from "../src/core/strategy/service.js";
import { MockStrategicBrain } from "../src/core/strategy/providers/mock-strategic-brain.js";
import { ProjectApprovalGate } from "../src/core/governance/project-approval-gate.js";
import { Planner } from "../src/core/planning/planner.js";
import { PlanningService } from "../src/core/planning/planning-service.js";

const stateManager = new ProjectStateManager();
const strategicBrain = new MockStrategicBrain();

const strategicService = new StrategicAnalysisService(
  stateManager,
  strategicBrain
);

const approvalGate = new ProjectApprovalGate(
  stateManager
);

const planner = new Planner();

const planningService = new PlanningService(
  stateManager,
  planner
);

const analysis = await strategicService.analyze({
  projectName: "Insurance management platform",
  prompt:
    "Build a professional platform to manage clients, policies, renewals, claims and documents."
});

console.log("\n=== 1. DIAGNOSIS ===");
console.log({
  projectId: analysis.project.id,
  phase: analysis.project.phase,
  status: analysis.project.status,
  requiresApproval: analysis.requiresApproval
});

const approval = approvalGate.approve(
  analysis.project.id,
  "The strategic diagnosis meets the established criteria."
);

console.log("\n=== 2. APPROVAL ===");
console.log({
  approved: approval.approved,
  phase: approval.project.phase,
  status: approval.project.status
});

const planning = planningService.plan(
  analysis.project.id
);

console.log("\n=== 3. PLANNING ===");
console.log({
  phase: planning.project.phase,
  status: planning.project.status,
  taskCount: planning.project.tasks.length,
  executionOrder: planning.planning.executionOrder
});

console.log("\n=== 4. TASKS ===");

for (const task of planning.project.tasks) {
  console.log({
    id: task.id,
    title: task.title,
    role: task.role,
    status: task.status,
    dependsOn: task.dependsOn
  });
}

