import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
import { StrategicBrainEngine } from "../src/core/strategy/engine.js";
import { BlueprintValidator } from "../src/core/strategy/validator.js";
import { StrategicAnalysisService } from "../src/core/strategy/service.js";
import { ProjectStateManager } from "../src/core/project-state/manager.js";

const provider = new MockAIProvider();

const validator = new BlueprintValidator();

const strategicBrain = new StrategicBrainEngine(
  provider,
  validator
);

const stateManager = new ProjectStateManager();

const analysisService = new StrategicAnalysisService(
  stateManager,
  strategicBrain
);

const result = await analysisService.analyze({
  projectName: "Insurance management platform",
  prompt:
    "Build a professional platform to manage clients, policies, renewals, claims and documents.",
  additionalContext: [
    "It must be secure.",
    "It must be scalable.",
    "It must have a professional user experience."
  ]
});

console.log(
  JSON.stringify(
    {
      projectId: result.project.id,
      projectName: result.project.brief.name,
      phase: result.project.phase,
      status: result.project.status,
      hasDiagnosis: Boolean(result.project.diagnosis),
      hasArchitecture: Boolean(result.project.architecture),
      requiresApproval: result.requiresApproval,
      metadataKeys: Object.keys(result.project.metadata)
    },
    null,
    2
  )
);
