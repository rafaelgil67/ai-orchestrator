/**
 * GroqProvider — direct AIProvider adapter for Groq's
 * OpenAI-compatible API (Phase B.8.1). Reuses the OmniRoute
 * transport verbatim: same endpoint shape, timeout, error
 * normalization and `simulated: false` metadata — only the
 * identity and endpoint differ. Groq's `json_schema` strict mode
 * uses constrained decoding, so ProjectBlueprint structured
 * output works end-to-end without OmniRoute in the middle.
 *
 * Endpoint: POST {baseUrl}/v1/chat/completions
 *   default baseUrl: https://api.groq.com/openai
 *   → https://api.groq.com/openai/v1/chat/completions
 *
 * Configuration policy: when AI_PROVIDER=groq is selected there is
 * NO mock fallback. A missing GROQ_API_KEY yields a configured-but-
 * unauthenticated provider whose generate() fails explicitly with
 * ProviderError("not_configured") through the normal error path.
 *
 * Secrets: GROQ_API_KEY travels only in the Authorization header
 * and never appears in errors, metadata or logs.
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

export const GROQ_API_BASE_URL = "https://api.groq.com/openai";
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

export class GroqProvider extends OmniRouteProvider {
  readonly id = "groq";
  readonly name = "Groq (direct)";

  protected readonly providerName = "Groq";
  protected readonly providerLabel = "Groq provider";

  constructor(
    config: Omit<OmniRouteConfig, "baseUrl"> & { baseUrl?: string }
  ) {
    super({
      ...config,
      baseUrl: config.baseUrl?.trim() || GROQ_API_BASE_URL
    });
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new ProviderError(
        "not_configured",
        "AI_PROVIDER=groq requires GROQ_API_KEY to be set."
      );
    }
    return super.generate(request);
  }
}
