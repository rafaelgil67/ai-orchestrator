/**
 * BlueprintValidator hardening suite — Phase B.5.5. A provider that
 * ignores the requested JSON schema may return a partially
 * structured blueprint (missing arrays/objects). The validator must
 * turn those cases into normal validation errors — never a
 * TypeError. Valid blueprints keep passing exactly as before.
 */
import { BlueprintValidator } from "../src/core/strategy/validator.js";
import { MockStrategicBrain } from "../src/core/strategy/providers/mock-strategic-brain.js";
import { ProjectBlueprint } from "../src/core/strategy/contracts.js";

let passed = 0;
let failed = 0;

function t(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

const v = new BlueprintValidator();
const valid = await new MockStrategicBrain().analyze({ prompt: "x" });

/** Validates without throwing; returns the result or null on crash. */
function safeValidate(bp: unknown) {
  try {
    return v.validate(bp as ProjectBlueprint);
  } catch {
    return null;
  }
}

function expectFailNoThrow(name: string, bp: unknown): void {
  const r = safeValidate(bp);
  t(`${name}: no exception`, r !== null);
  t(`${name}: validation FAIL`, r?.valid === false);
  t(`${name}: errors reported`, (r?.errors.length ?? 0) > 0);
}

// A — each required array absent
expectFailNoThrow("requirements absent", { ...valid, requirements: undefined });
expectFailNoThrow("masterPlan absent", { ...valid, masterPlan: undefined });
expectFailNoThrow(
  "definitionOfDone absent",
  { ...valid, definitionOfDone: undefined }
);

// D — architecture object absent
expectFailNoThrow("architecture absent", { ...valid, architecture: undefined });

// E + F — warning-source arrays absent
expectFailNoThrow("ambiguities absent", { ...valid, ambiguities: undefined });
expectFailNoThrow("risks absent", { ...valid, risks: undefined });

// Combined — the B.5 nemotron-style partial object
expectFailNoThrow("partial object (all fields missing)", {
  projectName: "x",
  originalPrompt: "x",
  interpretedObjective: "x"
});

// Non-object inputs
expectFailNoThrow("null blueprint", null);
expectFailNoThrow("string blueprint", "not an object");

// Wrong-typed fields must still fail cleanly
expectFailNoThrow("requirements as string", {
  ...valid,
  requirements: "nope"
});

// Positive regression — a real valid blueprint still passes
{
  const r = v.validate(valid);
  t("valid blueprint still PASSes", r.valid === true && r.errors.length === 0);
}

console.log(`\n${passed} passed · ${failed} failed\n`);
if (failed > 0) process.exit(1);
