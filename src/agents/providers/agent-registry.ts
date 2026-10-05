import {
  Agent,
  AgentCapability
} from "../contracts/agent.js";

export interface AgentSelectionCriteria {
  capability: AgentCapability;
  preferredAgentIds?: string[];
  providerIds?: string[];
}

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(
        `Agent already registered: ${agent.id}`
      );
    }

    this.agents.set(agent.id, agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  get(agentId: string): Agent {
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(
        `Agent not registered: ${agentId}`
      );
    }

    return agent;
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  select(criteria: AgentSelectionCriteria): Agent {
    let candidates = this.list().filter(agent =>
      agent.capabilities.includes(criteria.capability)
    );

    if (criteria.providerIds?.length) {
      candidates = candidates.filter(agent =>
        criteria.providerIds!.includes(agent.provider)
      );
    }

    if (candidates.length === 0) {
      throw new Error(
        `No agent available for capability: ${criteria.capability}`
      );
    }

    if (criteria.preferredAgentIds?.length) {
      for (const preferredId of criteria.preferredAgentIds) {
        const preferred = candidates.find(
          agent => agent.id === preferredId
        );

        if (preferred) {
          return preferred;
        }
      }
    }

    return candidates[0];
  }
}
