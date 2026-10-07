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
  projectName: "Insurance management platform",
  prompt:
    "I want to build a modern platform so an insurance intermediary can manage clients, policies, renewals, claims and documents.",
  additionalContext: [
    "It must be secure.",
    "It must be able to grow in the future.",
    "The experience must be professional and simple."
  ]
});

console.log(
  JSON.stringify(
    blueprint,
    null,
    2
  )
);

