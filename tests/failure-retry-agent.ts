import {
  Agent,
  AgentTask,
  AgentResult,
  AgentCapability
} from "../src/agents/contracts/agent.js";

export class FailureRetryAgent implements Agent {
  readonly id = "failure-retry-agent";
  readonly name = "Failure Retry Agent";
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
  private executions = 0;

  canHandle(task: AgentTask): boolean {
    return this.capabilities.includes(task.capability);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    this.executions++;

    this.receivedTasks.push(
      structuredClone(task)
    );

    const success =
      this.executions >= 2;

    return {
      success,

      summary: success
        ? `Ejecución exitosa en intento ${this.executions} para "${task.title}".`
        : `Fallo controlado en intento ${this.executions} para "${task.title}".`,

      outputs: {
        taskId: task.id,
        attempt: this.executions,
        executedBy: this.id
      },

      artifacts: [],

      issues: success
        ? []
        : [
            "Controlled test failure"
          ],

      metadata: {
        provider: this.provider,
        executionMode: this.executionMode,
        testMode: true
      }
    };
  }
}
