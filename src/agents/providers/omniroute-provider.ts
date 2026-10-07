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
    public readonly status?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class OmniRouteProvider implements AIProvider {
  readonly id = "omniroute";
  readonly name = "OmniRoute Gateway";

  constructor(private readonly config: OmniRouteConfig) {}

  supports(capability: AIProviderCapability): boolean {
    // Chat-completions gateway: all text capabilities, no vision.
    return capability !== "vision";
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const baseUrl = this.config.baseUrl?.trim();
    if (!baseUrl) {
      throw new ProviderError(
        "not_configured",
        "OmniRoute base URL is not configured."
      );
    }

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
          `OmniRoute request timed out after ${this.config.timeoutMs}ms.`
        );
      }
      throw new ProviderError(
        "network_error",
        "Could not reach the OmniRoute gateway."
      );
    }
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      throw new ProviderError(
        this.codeForStatus(res.status),
        `OmniRoute request failed (HTTP ${res.status}).`,
        res.status
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ProviderError(
        "invalid_response",
        "OmniRoute returned a non-JSON response."
      );
    }

    const parsed = this.parseChatCompletion(data);
    if (!parsed) {
      throw new ProviderError(
        "invalid_response",
        "OmniRoute response missing choices[0].message.content."
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
        attempt: 1
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
