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
  projectName: "Plataforma de gestión de seguros",
  prompt:
    "Crear una plataforma profesional para administrar clientes, pólizas, renovaciones, siniestros y documentos.",
  additionalContext: [
    "Debe ser segura.",
    "Debe ser escalable.",
    "Debe tener una experiencia de usuario profesional."
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
