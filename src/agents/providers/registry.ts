import {
  AIProvider,
  AIProviderCapability
} from "../contracts/ai-provider.js";

export interface ProviderSelectionCriteria {
  capabilities: AIProviderCapability[];
  preferredProviderIds?: string[];
  preferredModel?: string;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(
        `AI provider already registered: ${provider.id}`
      );
    }

    this.providers.set(provider.id, provider);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  get(providerId: string): AIProvider {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(
        `AI provider not registered: ${providerId}`
      );
    }

    return provider;
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  select(
    criteria: ProviderSelectionCriteria
  ): AIProvider {
    const candidates = this.list().filter(provider =>
      criteria.capabilities.every(capability =>
        provider.supports(capability)
      )
    );

    if (candidates.length === 0) {
      throw new Error(
        `No AI provider satisfies the requested capabilities: ${
          criteria.capabilities.join(", ")
        }`
      );
    }

    if (criteria.preferredProviderIds) {
      for (const preferredId of criteria.preferredProviderIds) {
        const preferred = candidates.find(
          provider => provider.id === preferredId
        );

        if (preferred) {
          return preferred;
        }
      }
    }

    return candidates[0];
  }
}
