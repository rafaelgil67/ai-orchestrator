import {
  AIProvider,
  AIRequest,
  AIResponse,
  AIProviderCapability
} from "../contracts/ai-provider.js";

export class MockAIProvider implements AIProvider {
  readonly id = "mock";
  readonly name = "Mock AI Provider";

  supports(capability: AIProviderCapability): boolean {
    return [
      "reasoning",
      "planning",
      "analysis",
      "structured_output",
      "coding",
      "code-review",
      "debugging"
    ].includes(capability);
  }

  async generate(
    request: AIRequest
  ): Promise<AIResponse> {
    const userMessage =
      request.messages.find(message => message.role === "user");

    let input: {
      projectName?: string;
      prompt?: string;
    } = {};

    try {
      input = JSON.parse(userMessage?.content ?? "{}");
    } catch {
      input = {};
    }

    const projectName =
      input.projectName?.trim() || "Unnamed project";

    const prompt =
      input.prompt?.trim() || "No description";

    const blueprint = {
      projectName,

      executiveSummary:
        `Initial analysis of project "${projectName}".`,

      originalPrompt: prompt,

      interpretedObjective:
        `Turn the objective described by the user into a professional, secure, maintainable and verifiable software solution.`,

      requirements: [
        {
          id: "REQ-001",
          title: "Fulfill the main objective",
          description: prompt,
          priority: "must",
          source: "explicit",
          acceptanceCriteria: [
            "The solution must fulfill the main objective defined by the user."
          ]
        }
      ],

      ambiguities: [],

      risks: [
        {
          id: "RISK-001",
          description:
            "Requirements may need refinement during detailed analysis.",
          level: "medium",
          mitigation:
            "Keep the blueprint as the source of truth and update it through recorded decisions."
        }
      ],

      recommendations: [
        {
          id: "REC-001",
          title: "Modular architecture",
          description:
            "Separate domain, infrastructure, agents, security and presentation.",
          rationale:
            "Enables independent evolution and reduces coupling.",
          impact: "high"
        }
      ],

      architecture: {
        summary:
          "Modular architecture based on components and decoupled agents.",
        frontend:
          "To be determined per project requirements.",
        backend:
          "To be determined per project requirements.",
        database:
          "To be determined per persistence needs.",
        infrastructure:
          "To be determined per availability and scale requirements.",
        integrations: [],
        security: [
          "Secure credential management.",
          "Least-privilege principle.",
          "Input and output validation."
        ],
        scalability: [
          "Decoupled components.",
          "Stable interfaces between agents."
        ]
      },

      masterPlan: [
        {
          id: "PHASE-001",
          name: "Discovery",
          objective: "Understand and specify the project.",
          deliverables: [
            "Requirements",
            "Architecture",
            "Definition of Done"
          ],
          dependencies: []
        },
        {
          id: "PHASE-002",
          name: "Implementation",
          objective: "Build the solution.",
          deliverables: [
            "Working application",
            "Tests"
          ],
          dependencies: ["PHASE-001"]
        },
        {
          id: "PHASE-003",
          name: "Verification",
          objective: "Validate quality, security and operation.",
          deliverables: [
            "QA",
            "Security audit",
            "Final validation"
          ],
          dependencies: ["PHASE-002"]
        }
      ],

      definitionOfDone: [
        "The solution meets the mandatory requirements.",
        "Critical tests pass.",
        "No known critical vulnerabilities exist.",
        "Required documentation is available."
      ],

      assumptions: [],

      requiresApproval: true,

      generatedAt: new Date().toISOString()
    };

    return {
      provider: this.id,
      model: "mock-strategic-model",
      content: JSON.stringify(blueprint),
      metadata: {
        testMode: true
      }
    };
  }
}

