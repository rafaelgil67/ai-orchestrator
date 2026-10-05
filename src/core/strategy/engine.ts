import {
  AIProvider,
  AIRequest
} from "../../agents/contracts/ai-provider.js";

import {
  StrategicAnalysisRequest,
  StrategicBrain,
  ProjectBlueprint
} from "./contracts.js";

import { BlueprintValidator } from "./validator.js";

export class StrategicBrainEngine implements StrategicBrain {
  constructor(
    private readonly provider: AIProvider,
    private readonly validator: BlueprintValidator
  ) {}

  async analyze(
    request: StrategicAnalysisRequest
  ): Promise<ProjectBlueprint> {
    const aiRequest: AIRequest = {
      messages: [
        {
          role: "system",
          content: this.buildSystemPrompt()
        },
        {
          role: "user",
          content: this.buildUserPrompt(request)
        }
      ],
      capabilities: [
        "reasoning",
        "planning",
        "analysis",
        "structured_output"
      ],
      responseFormat: "json"
    };

    const response = await this.provider.generate(aiRequest);

    const blueprint = this.parseBlueprint(
      response.content,
      request.prompt
    );

    const validation = this.validator.validate(blueprint);

    if (!validation.valid) {
      throw new Error(
        `Invalid project blueprint: ${validation.errors.join("; ")}`
      );
    }

    return blueprint;
  }

  private buildSystemPrompt(): string {
    return `
You are the Strategic Brain of an autonomous software engineering
orchestrator.

Your responsibility is to transform an initial user idea into a
professional Project Blueprint.

You must:

1. Understand the user's real objective.
2. Identify explicit requirements.
3. Infer reasonable implicit requirements.
4. Detect ambiguities.
5. Identify technical, operational and security risks.
6. Recommend improvements without changing the user's fundamental goal.
7. Propose an appropriate architecture.
8. Create a realistic master execution plan.
9. Define measurable acceptance criteria.
10. Produce a clear Definition of Done.

You are not the implementation agent.

Do not write application code.

Return ONLY valid JSON matching the requested ProjectBlueprint structure.
`;
  }

  private buildUserPrompt(
    request: StrategicAnalysisRequest
  ): string {
    return JSON.stringify({
      projectName: request.projectName,
      prompt: request.prompt,
      additionalContext: request.additionalContext ?? []
    });
  }

  private parseBlueprint(
    content: string,
    originalPrompt: string
  ): ProjectBlueprint {
    let parsed: ProjectBlueprint;

    try {
      parsed = JSON.parse(content) as ProjectBlueprint;
    } catch {
      throw new Error(
        "AI provider returned invalid JSON."
      );
    }

    return {
      ...parsed,
      originalPrompt
    };
  }
}
