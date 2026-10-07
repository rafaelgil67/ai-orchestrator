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
import { MockAIProvider } from "./mock-provider.js";
import { OmniRouteProvider } from "./omniroute-provider.js";

export const DEFAULT_OMNIROUTE_TIMEOUT_MS = 30_000;

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
    return new OmniRouteProvider({
      baseUrl,
      apiKey: env.OMNIROUTE_API_KEY?.trim() || undefined,
      model: env.OMNIROUTE_MODEL?.trim() || "auto",
      timeoutMs:
        Number(env.OMNIROUTE_TIMEOUT_MS) || DEFAULT_OMNIROUTE_TIMEOUT_MS
    });
  }
  return new MockAIProvider();
}
