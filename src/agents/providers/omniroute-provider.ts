/**
 * OmniRouteProvider — real AIProvider adapter for the OmniRoute
 * gateway (Phase B). OmniRoute exposes an OpenAI-compatible
 * `POST {baseUrl}/v1/chat/completions` endpoint and routes to
 * whatever upstream models are configured on it.
 *
 * Design constraints honored here:
 *  - zero dependencies — uses the global fetch + AbortSignal.timeout;
 *  - nothing is hardcoded: URL, key and model come from config/env;
 *  - secrets are never logged and never appear in thrown errors;
 *  - responses are marked `simulated: false` in metadata — a real
 *    provider answer can never be mistaken for a mock response.
 */
import {
  AIProvider,
  AIProviderCapability,
  AIRequest,
  AIResponse
} from "../contracts/ai-provider.js";

export interface OmniRouteConfig {
  /** e.g. http://localhost:20128 — no trailing slash needed. */
  baseUrl: string;
  /** Optional bearer token for a secured OmniRoute instance. */
  apiKey?: string;
  /** Model id, or OmniRoute's "auto" routing. */
  model: string;
  /** Hard timeout per request. */
  timeoutMs: number;
}

export type ProviderErrorCode =
  | "not_configured"
  | "bad_request"
  | "unauthorized"
  | "provider_not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "network_error"
  | "invalid_response";

/** Normalized provider error — carries no secrets, no headers, no prompts. */
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly status?: number,
    /** Parsed+clamped Retry-After delay (ms); only set for 429s. */
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Hard cap on retry backoff — never trust an arbitrary Retry-After. */
const MAX_RETRY_DELAY_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parses a Retry-After header (integer seconds only — HTTP-date forms
 * fall back). Clamped to MAX_RETRY_DELAY_MS so a hostile/buggy upstream
 * cannot park a request for minutes.
 */
function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value.trim());
  if (!Number.isInteger(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
}

export class OmniRouteProvider implements AIProvider {
  readonly id: string = "omniroute";
  readonly name: string = "OmniRoute Gateway";

  /** Short name used in error messages (e.g. "OmniRoute request failed"). */
  protected readonly providerName: string = "OmniRoute";
  /** Noun phrase used in connectivity errors (e.g. "the OmniRoute gateway"). */
  protected readonly providerLabel: string = "OmniRoute gateway";

  constructor(protected readonly config: OmniRouteConfig) {}

  supports(capability: AIProviderCapability): boolean {
    // Chat-completions gateway: all text capabilities, no vision.
    return capability !== "vision";
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const baseUrl = this.config.baseUrl?.trim();
    if (!baseUrl) {
      throw new ProviderError(
        "not_configured",
        `${this.providerName} base URL is not configured.`
      );
    }

    // Bounded retry (Phase B.8.7): at most ONE extra attempt, only for
    // transient classes. Idempotent — generation has no side effects.
    const maxAttempts = 2;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.requestOnce(request, baseUrl, attempt);
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          attempt >= maxAttempts ||
          !this.shouldRetry(error, request)
        ) {
          throw error;
        }
        await sleep(this.retryDelayMs(error));
      }
    }
  }

  private shouldRetry(
    error: ProviderError,
    request: AIRequest
  ): boolean {
    if (error.code === "bad_request") {
      // Groq returns flaky 400s on strict json_schema requests — one
      // retry is justified only for structured-output calls.
      return request.responseSchema !== undefined;
    }
    return (
      error.code === "rate_limited" ||
      error.code === "provider_unavailable" ||
      error.code === "timeout" ||
      error.code === "network_error"
    );
  }

  private retryDelayMs(error: ProviderError): number {
    if (error.code === "rate_limited") {
      return error.retryAfterMs ?? 1000;
    }
    return 500;
  }

  private async requestOnce(
    request: AIRequest,
    baseUrl: string,
    attempt: number
  ): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.config.model,
      messages: request.messages
    };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.responseSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.responseSchema.name,
          strict: true,
          schema: request.responseSchema.schema
        }
      };
    } else if (request.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (error) {
      if (this.isTimeout(error)) {
        throw new ProviderError(
          "timeout",
          `${this.providerName} request timed out after ` +
            `${this.config.timeoutMs}ms.`
        );
      }
      throw new ProviderError(
        "network_error",
        `Could not reach the ${this.providerLabel}.`
      );
    }
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const code = this.codeForStatus(res.status);
      throw new ProviderError(
        code,
        `${this.providerName} request failed (HTTP ${res.status}).`,
        res.status,
        code === "rate_limited"
          ? parseRetryAfterMs(res.headers.get("retry-after"))
          : undefined
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ProviderError(
        "invalid_response",
        `${this.providerName} returned a non-JSON response.`
      );
    }

    const parsed = this.parseChatCompletion(data);
    if (!parsed) {
      throw new ProviderError(
        "invalid_response",
        `${this.providerName} response missing ` +
          `choices[0].message.content.`
      );
    }

    return {
      provider: this.id,
      model: parsed.model ?? request.model ?? this.config.model,
      content: parsed.content,
      usage: parsed.usage,
      metadata: {
        simulated: false,
        latencyMs,
        attempt
      }
    };
  }

  private codeForStatus(status: number): ProviderErrorCode {
    if (status === 400) return "bad_request";
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 404) return "provider_not_found";
    if (status === 429) return "rate_limited";
    if (status >= 500) return "provider_unavailable";
    return "invalid_response";
  }

  private isTimeout(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    );
  }

  private parseChatCompletion(data: unknown): {
    content: string;
    model?: string;
    usage?: AIResponse["usage"];
  } | null {
    if (typeof data !== "object" || data === null) return null;
    const d = data as {
      choices?: { message?: { content?: unknown } }[];
      model?: unknown;
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        total_tokens?: unknown;
      };
    };
    const content = d.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;

    const u = d.usage;
    const usage =
      u && typeof u === "object"
        ? {
            inputTokens:
              typeof u.prompt_tokens === "number"
                ? u.prompt_tokens
                : undefined,
            outputTokens:
              typeof u.completion_tokens === "number"
                ? u.completion_tokens
                : undefined,
            totalTokens:
              typeof u.total_tokens === "number"
                ? u.total_tokens
                : undefined
          }
        : undefined;

    return {
      content,
      model: typeof d.model === "string" ? d.model : undefined,
      usage
    };
  }
}
