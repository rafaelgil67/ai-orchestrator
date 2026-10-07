export type AIProviderCapability =
  | "reasoning"
  | "coding"
  | "planning"
  | "analysis"
  | "vision"
  | "structured_output";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Optional JSON Schema for OpenAI-compatible Structured Outputs.
 * Providers that support `response_format: { type: "json_schema" }`
 * enforce the schema; others may ignore it. Optional — requests
 * without it behave exactly as before.
 */
export interface AIResponseSchema {
  /** Schema name sent upstream, e.g. "ProjectBlueprint". */
  name: string;
  /** JSON Schema object describing the required response shape. */
  schema: Record<string, unknown>;
}

export interface AIRequest {
  messages: AIMessage[];

  model?: string;

  temperature?: number;

  maxTokens?: number;

  capabilities?: AIProviderCapability[];

  responseFormat?: "text" | "json";

  responseSchema?: AIResponseSchema;
}

export interface AIResponse {
  provider: string;
  model: string;

  content: string;

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };

  metadata?: Record<string, unknown>;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;

  supports(
    capability: AIProviderCapability
  ): boolean;

  generate(
    request: AIRequest
  ): Promise<AIResponse>;
}
