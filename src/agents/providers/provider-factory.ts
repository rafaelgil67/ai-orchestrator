/**
 * Provider factory — selects the AIProvider from environment config.
 *
 * Rules (Phase B policy):
 *  - default is ALWAYS MockAIProvider (`AI_PROVIDER` unset or "mock");
 *  - `AI_PROVIDER=omniroute` activates the real adapter — but ONLY when
 *    OMNIROUTE_URL is configured; otherwise we log a warning and stay
 *    on mock rather than running a half-configured "real" provider;
 *  - there is NO silent real→mock downgrade inside an execution: a
 *    provider marked real either works or fails explicitly, and
 *    responses carry `metadata.simulated` to keep the two honest.
 */
import { AIProvider } from "../contracts/ai-provider.js";
import { FallbackProvider } from "./fallback-provider.js";
import { GroqProvider, GROQ_DEFAULT_MODEL } from "./groq-provider.js";
import { MockAIProvider } from "./mock-provider.js";
import { OmniRouteProvider } from "./omniroute-provider.js";
import {
  OpenRouterProvider,
  OPENROUTER_API_BASE_URL,
  OPENROUTER_DEFAULT_MODEL
} from "./openrouter-provider.js";

export const DEFAULT_OMNIROUTE_TIMEOUT_MS = 30_000;

/** Fallback defaults — B.9.8 measured OpenRouter upstreams at ~60–80s. */
export const OPENROUTER_FALLBACK_DEFAULT_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_FALLBACK_TIMEOUT_MS = 120_000;

/**
 * Opt-in emergency fallback (Phase B.10): only
 * `AI_FALLBACK_PROVIDER=openrouter` wraps the primary, and only when the
 * primary is a real provider that isn't already OpenRouter. The mock
 * never needs a fallback; an OpenRouter primary never falls back to
 * itself. OPENROUTER_FALLBACK_* are independent of OPENROUTER_* so a
 * direct OpenRouter setup keeps its own model/timeout.
 */
function withFallback(
  primary: AIProvider,
  env: Record<string, string | undefined>
): AIProvider {
  if (
    env.AI_FALLBACK_PROVIDER !== "openrouter" ||
    primary instanceof MockAIProvider ||
    primary instanceof OpenRouterProvider
  ) {
    return primary;
  }
  const fallback = new OpenRouterProvider({
    baseUrl: OPENROUTER_API_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
    model:
      env.OPENROUTER_FALLBACK_MODEL?.trim() ||
      OPENROUTER_FALLBACK_DEFAULT_MODEL,
    timeoutMs:
      Number(env.OPENROUTER_FALLBACK_TIMEOUT_MS) ||
      DEFAULT_FALLBACK_TIMEOUT_MS
  });
  return new FallbackProvider(primary, fallback);
}

export function createAIProvider(
  env: Record<string, string | undefined> = process.env
): AIProvider {
  if (env.AI_PROVIDER === "omniroute") {
    const baseUrl = env.OMNIROUTE_URL?.trim();
    if (!baseUrl) {
      console.warn(
        "[providers] AI_PROVIDER=omniroute but OMNIROUTE_URL is not " +
          "set — staying on the mock provider for this process."
      );
      return new MockAIProvider();
    }
    return withFallback(
      new OmniRouteProvider({
        baseUrl,
        apiKey: env.OMNIROUTE_API_KEY?.trim() || undefined,
        model: env.OMNIROUTE_MODEL?.trim() || "auto",
        timeoutMs:
          Number(env.OMNIROUTE_TIMEOUT_MS) || DEFAULT_OMNIROUTE_TIMEOUT_MS
      }),
      env
    );
  }
  if (env.AI_PROVIDER === "groq") {
    // Explicit provider, no mock fallback: a missing GROQ_API_KEY
    // yields a provider whose generate() fails with
    // ProviderError("not_configured") instead of silently using mock.
    return withFallback(
      new GroqProvider({
        apiKey: env.GROQ_API_KEY?.trim() || undefined,
        model: env.AI_MODEL?.trim() || GROQ_DEFAULT_MODEL,
        timeoutMs:
          Number(env.GROQ_TIMEOUT_MS) || DEFAULT_OMNIROUTE_TIMEOUT_MS
      }),
      env
    );
  }
  if (env.AI_PROVIDER === "openrouter") {
    // Same explicit-provider policy as groq: a missing
    // OPENROUTER_API_KEY fails with ProviderError("not_configured")
    // at generate() time — never a silent mock fallback.
    return withFallback(
      new OpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
        model: env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL,
        timeoutMs:
          Number(env.OPENROUTER_TIMEOUT_MS) || DEFAULT_OMNIROUTE_TIMEOUT_MS
      }),
      env
    );
  }
  return new MockAIProvider();
}
