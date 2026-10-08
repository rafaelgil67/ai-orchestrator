/**
 * FallbackProvider — sequential primary→fallback chain (Phase B.10).
 *
 * Policy:
 *  - the primary provider always answers first, including its own
 *    internal B.8.7 retries;
 *  - ONLY a final ProviderError with a transient code
 *    (timeout | network_error | rate_limited | provider_unavailable)
 *    escalates to the fallback provider — at most once per request;
 *  - permanent errors (4xx, not_configured, invalid_response, …) and
 *    non-ProviderError failures propagate untouched;
 *  - strictly sequential: never parallel, never a loop, never
 *    fallback→primary.
 *
 * The AIResponse keeps the responder's identity (res.provider) and the
 * wrapper annotates metadata.primaryProvider / metadata.fallbackUsed —
 * additive keys only, no secrets, no public-contract changes.
 */
import {
  AIProvider,
  AIRequest,
  AIResponse,
  AIProviderCapability
} from "../contracts/ai-provider.js";
import { ProviderError, ProviderErrorCode } from "./omniroute-provider.js";

const FALLBACK_ELIGIBLE: ReadonlySet<ProviderErrorCode> = new Set([
  "timeout",
  "network_error",
  "rate_limited",
  "provider_unavailable"
]);

export class FallbackProvider implements AIProvider {
  readonly id: string;
  readonly name: string;

  constructor(
    readonly primary: AIProvider,
    readonly fallback: AIProvider
  ) {
    this.id = primary.id;
    this.name = `${primary.name} (fallback: ${fallback.name})`;
  }

  supports(capability: AIProviderCapability): boolean {
    return this.primary.supports(capability);
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    try {
      const res = await this.primary.generate(request);
      return {
        ...res,
        metadata: {
          ...res.metadata,
          primaryProvider: this.primary.id,
          fallbackUsed: false
        }
      };
    } catch (error) {
      if (
        !(error instanceof ProviderError) ||
        !FALLBACK_ELIGIBLE.has(error.code)
      ) {
        throw error;
      }
      const res = await this.fallback.generate(request);
      return {
        ...res,
        metadata: {
          ...res.metadata,
          primaryProvider: this.primary.id,
          primaryError: error.code,
          fallbackUsed: true
        }
      };
    }
  }
}
