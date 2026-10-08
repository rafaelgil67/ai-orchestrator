/**
 * OpenRouterProvider — direct AIProvider adapter for OpenRouter's
 * OpenAI-compatible API (Phase B.9). Reuses the OmniRoute transport
 * verbatim — same endpoint shape, timeout, B.8.7 retry policy and
 * `simulated: false` metadata — only the identity and endpoint
 * differ.
 *
 * Endpoint: POST {baseUrl}/v1/chat/completions
 *   default baseUrl: https://openrouter.ai/api
 *   → https://openrouter.ai/api/v1/chat/completions
 *
 * Default model: "openrouter/free" — OpenRouter's free-tier router,
 * which picks among free models. Structured output (json_schema +
 * strict) support depends on the model the router selects, so this
 * provider is validated for the contract but its free-tier model
 * may legitimately 400 on strict schemas — the B.8.7 single retry
 * on bad_request applies, then the error propagates explicitly.
 *
 * Configuration policy: when AI_PROVIDER=openrouter is selected
 * there is NO mock fallback. A missing OPENROUTER_API_KEY yields a
 * provider whose generate() fails explicitly with
 * ProviderError("not_configured") through the normal error path.
 *
 * Secrets: OPENROUTER_API_KEY travels only in the Authorization
 * header and never appears in errors, metadata or logs.
 */
import {
  AIRequest,
  AIResponse
} from "../contracts/ai-provider.js";
import {
  OmniRouteConfig,
  OmniRouteProvider,
  ProviderError
} from "./omniroute-provider.js";

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api";
export const OPENROUTER_DEFAULT_MODEL = "openrouter/free";

export class OpenRouterProvider extends OmniRouteProvider {
  readonly id = "openrouter";
  readonly name = "OpenRouter";

  protected readonly providerName = "OpenRouter";
  protected readonly providerLabel = "OpenRouter provider";

  constructor(
    config: Omit<OmniRouteConfig, "baseUrl"> & { baseUrl?: string }
  ) {
    super({
      ...config,
      baseUrl: config.baseUrl?.trim() || OPENROUTER_API_BASE_URL
    });
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new ProviderError(
        "not_configured",
        "AI_PROVIDER=openrouter requires OPENROUTER_API_KEY to be set."
      );
    }
    return super.generate(request);
  }
}
