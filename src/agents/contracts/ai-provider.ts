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

export interface AIRequest {
  messages: AIMessage[];

  model?: string;

  temperature?: number;

  maxTokens?: number;

  capabilities?: AIProviderCapability[];

  responseFormat?: "text" | "json";
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
