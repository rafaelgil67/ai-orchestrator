import {
  Agent,
  AgentTask,
  AgentResult,
  AgentCapability
} from "../contracts/agent.js";

export class MockAgent implements Agent {
  readonly id = "mock-agent";
  readonly name = "Mock Software Agent";
  readonly provider = "mock";

  readonly capabilities: AgentCapability[] = [
    "requirements",
    "architecture",
    "coding",
    "database",
    "uiux",
    "testing",
    "security",
    "devops",
    "research",
    "debugging",
    "code-review"
  ];

  readonly executionMode = "synchronous" as const;

  canHandle(task: AgentTask): boolean {
    return this.capabilities.includes(task.capability);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    return {
      success: true,
      summary:
        `Mock agent successfully executed task "${task.title}".`,
      outputs: {
        taskId: task.id,
        capability: task.capability,
        executedBy: this.id,
        testMode: true
      },
      artifacts: [],
      issues: [],
      metadata: {
        provider: this.provider,
        executionMode: this.executionMode
      }
    };
  }
}
