import { ProjectStateManager } from "../project-state/manager.js";
import { ProjectState } from "../project-state/types.js";
import {
  StrategicBrain,
  StrategicAnalysisRequest
} from "./contracts.js";

export interface StrategicAnalysisResult {
  project: ProjectState;
  requiresApproval: boolean;
}

export class StrategicAnalysisService {
  constructor(
    private readonly stateManager: ProjectStateManager,
    private readonly strategicBrain: StrategicBrain
  ) {}

  async analyze(
    request: StrategicAnalysisRequest
  ): Promise<StrategicAnalysisResult> {
    const project = this.stateManager.createProject({
      name: request.projectName?.trim() || "Unnamed project",
      objective: request.prompt,
      originalPrompt: request.prompt,
      constraints: request.additionalContext ?? []
    });

    const blueprint = await this.strategicBrain.analyze(request);

    const diagnosis = JSON.stringify(
      {
        executiveSummary: blueprint.executiveSummary,
        interpretedObjective: blueprint.interpretedObjective,
        requirements: blueprint.requirements,
        ambiguities: blueprint.ambiguities,
        risks: blueprint.risks,
        recommendations: blueprint.recommendations,
        assumptions: blueprint.assumptions
      },
      null,
      2
    );

    const architecture = JSON.stringify(
      blueprint.architecture,
      null,
      2
    );

    const updatedProject = this.stateManager.setDiagnosis(
      project.id,
      diagnosis,
      blueprint.interpretedObjective
    );

    const finalProject = this.stateManager.setArchitecture(
      updatedProject.id,
      architecture
    );

    this.stateManager.setMetadata(
      finalProject.id,
      "strategicBlueprint",
      blueprint
    );

    this.stateManager.setMetadata(
      finalProject.id,
      "definitionOfDone",
      blueprint.definitionOfDone
    );

    this.stateManager.setMetadata(
      finalProject.id,
      "masterPlan",
      blueprint.masterPlan
    );

    return {
      project: this.stateManager.getProject(finalProject.id),
      requiresApproval: blueprint.requiresApproval
    };
  }
}

