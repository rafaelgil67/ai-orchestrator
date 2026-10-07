import {
  AIProvider,
  AIRequest
} from "../../agents/contracts/ai-provider.js";

import {
  StrategicAnalysisRequest,
  StrategicBrain,
  ProjectBlueprint,
  PROJECT_BLUEPRINT_JSON_SCHEMA
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
      responseFormat: "json",
      responseSchema: {
        name: "ProjectBlueprint",
        schema: PROJECT_BLUEPRINT_JSON_SCHEMA
      }
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

Your entire response must be a single valid JSON object matching
the ProjectBlueprint structure defined in src/core/strategy/contracts.ts:

{
  "projectName": "string",
  "executiveSummary": "string",
  "originalPrompt": "string — echo the user's original prompt",
  "interpretedObjective": "string",
  "requirements": [{
    "id": "string",
    "title": "string",
    "description": "string",
    "priority": "must | should | could | out_of_scope",
    "source": "explicit | inferred | recommended",
    "acceptanceCriteria": ["string"]
  }],
  "ambiguities": [{
    "id": "string",
    "description": "string",
    "impact": "string",
    "suggestedResolution": "string",
    "requiresUserDecision": "boolean"
  }],
  "risks": [{
    "id": "string",
    "description": "string",
    "level": "low | medium | high | critical",
    "mitigation": "string"
  }],
  "recommendations": [{
    "id": "string",
    "title": "string",
    "description": "string",
    "rationale": "string",
    "impact": "low | medium | high"
  }],
  "architecture": {
    "summary": "string",
    "frontend": "string (optional)",
    "backend": "string (optional)",
    "database": "string (optional)",
    "infrastructure": "string (optional)",
    "integrations": ["string"],
    "security": ["string"],
    "scalability": ["string"]
  },
  "masterPlan": [{
    "id": "string",
    "name": "string",
    "objective": "string",
    "deliverables": ["string"],
    "dependencies": ["string"]
  }],
  "definitionOfDone": ["string"],
  "assumptions": ["string"],
  "requiresApproval": true,
  "generatedAt": "ISO-8601 timestamp string"
}

Rules:

- Return ONLY the JSON object. No markdown. No \`\`\`json fences.
- No explanation before or after the JSON.
- All fields listed above are mandatory and must use the exact
  names and types shown. Use empty arrays where no items apply.
- Respond with one JSON object as your entire message.
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
