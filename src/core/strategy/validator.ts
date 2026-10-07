import {
  ProjectBlueprint
} from "./contracts.js";

export interface BlueprintValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class BlueprintValidator {
  validate(
    blueprint: ProjectBlueprint
  ): BlueprintValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Partial/malformed blueprints (e.g. a provider that ignores the
    // requested schema) must produce validation errors, never a
    // TypeError. Guard every structural access before use.
    if (blueprint === null || typeof blueprint !== "object") {
      errors.push("Blueprint must be an object.");
      return { valid: false, errors, warnings };
    }

    if (!blueprint.projectName?.trim()) {
      errors.push("Project name is required.");
    }

    if (!blueprint.originalPrompt?.trim()) {
      errors.push("Original prompt is required.");
    }

    if (!blueprint.interpretedObjective?.trim()) {
      errors.push("Interpreted objective is required.");
    }

    if (
      !Array.isArray(blueprint.requirements) ||
      blueprint.requirements.length === 0
    ) {
      errors.push("At least one requirement is required.");
    }

    if (
      !Array.isArray(blueprint.masterPlan) ||
      blueprint.masterPlan.length === 0
    ) {
      errors.push("Master plan cannot be empty.");
    }

    if (
      !Array.isArray(blueprint.definitionOfDone) ||
      blueprint.definitionOfDone.length === 0
    ) {
      errors.push("Definition of Done cannot be empty.");
    }

    if (!blueprint.architecture?.summary?.trim()) {
      errors.push("Architecture summary is required.");
    }

    if (!Array.isArray(blueprint.ambiguities)) {
      errors.push("Ambiguities must be an array.");
    } else if (
      blueprint.ambiguities.some(
        ambiguity => ambiguity.requiresUserDecision
      )
    ) {
      warnings.push(
        "The blueprint contains ambiguities that may require user clarification."
      );
    }

    if (!Array.isArray(blueprint.risks)) {
      errors.push("Risks must be an array.");
    } else if (
      blueprint.risks.some(
        risk => risk.level === "critical"
      )
    ) {
      warnings.push(
        "Critical risks were identified and must be addressed before execution."
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}
