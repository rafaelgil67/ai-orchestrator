/**
 * Web layer error handling — stable JSON error contract for the demo API.
 * Never leaks stack traces or internal details to the browser.
 */
export type ApiErrorCode =
  | "invalid_input"
  | "invalid_brief"
  | "session_not_found"
  | "session_capacity_reached"
  | "approval_required"
  | "invalid_state_transition"
  | "execution_in_progress"
  | "rate_limited"
  | "not_found"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorBody(code: ApiErrorCode, message: string) {
  return { error: { code, message } };
}

/**
 * Maps unknown/core errors to a safe response. Core errors (e.g. the
 * Approval Gate refusing a transition) become 409 invalid_state_transition;
 * everything else is a generic 500 — internals stay server-side.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  const message =
    error instanceof Error ? error.message : String(error);
  if (
    /not awaiting approval|not ready for|not found|not eligible|not executable/i.test(
      message
    )
  ) {
    return new ApiError(409, "invalid_state_transition", "The requested action is not valid for the current demo state.");
  }
  return new ApiError(500, "internal_error", "An internal error occurred.");
}
