/**
 * Web layer input validation — strict whitelist. The client may only send
 * high-level fields (brief, projectName, rationale). Engine budgets,
 * phases, statuses, decisions and internal IDs are NEVER accepted.
 */
import { IncomingMessage } from "node:http";
import { ApiError } from "./errors.js";

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_BRIEF_CHARS = 4096;
export const MAX_NAME_CHARS = 120;
export const MAX_RATIONALE_CHARS = 500;

/** Reads a request body with a hard byte cap; rejects oversized payloads. */
export async function readBody(req: IncomingMessage): Promise<unknown> {
  const decoder = new TextDecoder();
  let raw = "";
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Uint8Array;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new ApiError(400, "invalid_input", "Request body exceeds the maximum allowed size.");
    }
    raw += decoder.decode(buf, { stream: true });
  }

  raw = raw.trim();
  if (raw.length === 0) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "invalid_input", "Request body must be valid JSON.");
  }
}

function assertPlainObject(
  body: unknown,
  allowedKeys: string[]
): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "invalid_input", "Request body must be a JSON object.");
  }
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) {
      throw new ApiError(
        400,
        "invalid_input",
        `Field "${key}" is not accepted by this endpoint.`
      );
    }
  }
  return obj;
}

function optionalString(
  value: unknown,
  field: string,
  maxChars: number
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_input", `Field "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new ApiError(
      400,
      "invalid_input",
      `Field "${field}" exceeds ${maxChars} characters.`
    );
  }
  return trimmed;
}

export interface CreateDemoInput {
  brief: string;
  projectName?: string;
}

export function parseCreateBody(body: unknown): CreateDemoInput {
  const obj = assertPlainObject(body, ["brief", "projectName"]);

  const brief = optionalString(obj.brief, "brief", MAX_BRIEF_CHARS);
  if (!brief) {
    throw new ApiError(400, "invalid_brief", "Field \"brief\" is required and must be a non-empty string.");
  }

  return {
    brief,
    projectName: optionalString(obj.projectName, "projectName", MAX_NAME_CHARS)
  };
}

export interface DecisionInput {
  rationale?: string;
}

export function parseDecisionBody(body: unknown): DecisionInput {
  const obj = assertPlainObject(body, ["rationale"]);
  return {
    rationale: optionalString(obj.rationale, "rationale", MAX_RATIONALE_CHARS)
  };
}

export function parseEmptyBody(body: unknown): void {
  assertPlainObject(body, []);
}

/**
 * Content-Type policy (R-07): when a request carries a body, it must be
 * declared as application/json (charset suffix allowed). Checked BEFORE
 * consuming the body. A genuinely empty body stays allowed — POST /run
 * sends no payload.
 */
export function assertJsonContentType(req: IncomingMessage): void {
  const hasBody =
    req.headers["content-length"] !== undefined ||
    req.headers["transfer-encoding"] !== undefined;
  if (!hasBody) {
    return;
  }

  const contentType = req.headers["content-type"];
  const normalized = (
    Array.isArray(contentType) ? contentType[0] : contentType ?? ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (normalized !== "application/json") {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Request body must be application/json."
    );
  }
}
