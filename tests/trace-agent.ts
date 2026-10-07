import {
  Agent,
  AgentTask,
  AgentResult,
  AgentCapability
} from "../src/agents/contracts/agent.js";

export class TraceAgent implements Agent {
  readonly id = "trace-agent";
  readonly name = "Trace Agent";
  readonly provider = "test";

  readonly capabilities: AgentCapability[] = [
    "requirements",
    "architecture",
    "coding",
    "database",
    "uiux",
    "testing",
    "security",
    "devops"
  ];

  readonly executionMode = "synchronous" as const;

  readonly receivedTasks: AgentTask[] = [];

  canHandle(task: AgentTask): boolean {
    return this.capabilities.includes(task.capability);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    this.receivedTasks.push(structuredClone(task));

    return {
      success: true,
      summary: `Trace agent executed "${task.title}".`,
      outputs: {
        traceTaskId: task.id,
        capability: task.capability,
        executedBy: this.id
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
