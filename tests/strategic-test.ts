import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
import { StrategicBrainEngine } from "../src/core/strategy/engine.js";
import { BlueprintValidator } from "../src/core/strategy/validator.js";

const provider = new MockAIProvider();

const validator = new BlueprintValidator();

const strategicBrain = new StrategicBrainEngine(
  provider,
  validator
);

const blueprint = await strategicBrain.analyze({
  projectName: "Plataforma de gestión de seguros",
  prompt:
    "Quiero crear una plataforma moderna para que un intermediario de seguros pueda administrar clientes, pólizas, renovaciones, siniestros y documentos.",
  additionalContext: [
    "Debe ser segura.",
    "Debe poder crecer a futuro.",
    "La experiencia debe ser profesional y sencilla."
  ]
});

console.log(
  JSON.stringify(
    blueprint,
    null,
    2
  )
);

