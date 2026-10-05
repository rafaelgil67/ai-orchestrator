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

    if (!blueprint.projectName?.trim()) {
      errors.push("Project name is required.");
    }

    if (!blueprint.originalPrompt?.trim()) {
      errors.push("Original prompt is required.");
    }

    if (!blueprint.interpretedObjective?.trim()) {
      errors.push("Interpreted objective is required.");
    }

    if (!blueprint.requirements.length) {
      errors.push("At least one requirement is required.");
    }

    if (!blueprint.masterPlan.length) {
      errors.push("Master plan cannot be empty.");
    }

    if (!blueprint.definitionOfDone.length) {
      errors.push("Definition of Done cannot be empty.");
    }

    if (!blueprint.architecture.summary?.trim()) {
      errors.push("Architecture summary is required.");
    }

    if (blueprint.ambiguities.some(
      ambiguity => ambiguity.requiresUserDecision
    )) {
      warnings.push(
        "The blueprint contains ambiguities that may require user clarification."
      );
    }

    if (blueprint.risks.some(
      risk => risk.level === "critical"
    )) {
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
