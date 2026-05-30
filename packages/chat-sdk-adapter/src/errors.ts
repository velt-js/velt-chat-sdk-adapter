import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
} from "@chat-adapter/shared";

/** Adapter name used in error messages and the `Adapter.name` field. */
export const ADAPTER_NAME = "velt";

interface VeltErrorContext {
  /** What we were doing, e.g. "post comment". Used in messages. */
  action: string;
  /** Optional resource type for not-found errors, e.g. "thread". */
  resourceType?: string;
  /** Optional resource id for not-found errors. */
  resourceId?: string;
}

/** Best-effort extraction of an HTTP status code from a thrown value. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"]) {
    const v = e[key];
    if (typeof v === "number") return v;
  }
  const response = e.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === "number") return response.status;
  return undefined;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

/**
 * Translate an arbitrary error from `@veltdev/node` / `fetch` into a
 * standardized `@chat-adapter/shared` error class. Pass-through if the error is
 * already an `AdapterError`.
 */
export function mapVeltError(error: unknown, context: VeltErrorContext): AdapterError {
  if (error instanceof AdapterError) return error;

  const status = statusOf(error);
  const message = messageOf(error, `Velt request failed: ${context.action}`);

  switch (status) {
    case 401:
      return new AuthenticationError(ADAPTER_NAME, message);
    case 403:
      return new PermissionError(ADAPTER_NAME, context.action);
    case 404:
      return new ResourceNotFoundError(
        ADAPTER_NAME,
        context.resourceType ?? "resource",
        context.resourceId,
      );
    case 429: {
      const retryAfter =
        typeof (error as Record<string, unknown>)?.retryAfter === "number"
          ? ((error as Record<string, unknown>).retryAfter as number)
          : undefined;
      return new AdapterRateLimitError(ADAPTER_NAME, retryAfter);
    }
    default:
      break;
  }

  // Network-ish errors (fetch failures, DNS, timeouts) have no HTTP status.
  if (status === undefined && error instanceof Error) {
    return new NetworkError(ADAPTER_NAME, message, error);
  }

  return new AdapterError(message, ADAPTER_NAME, status ? String(status) : undefined);
}

/**
 * Error thrown when an operation is not supported by the configured Velt
 * backend (e.g. writing reactions on the managed/hosted backend).
 */
export function notSupported(action: string, hint: string): PermissionError {
  return new PermissionError(ADAPTER_NAME, `${action} — ${hint}`);
}
