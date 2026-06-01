import { describe, expect, it } from "vitest";
import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
} from "@chat-adapter/shared";
import { mapVeltError, notSupported } from "../errors.js";

describe("mapVeltError", () => {
  it("passes through an existing AdapterError unchanged", () => {
    const original = new AuthenticationError("velt", "nope");
    expect(mapVeltError(original, { action: "post comment" })).toBe(original);
  });

  it("maps 401 to AuthenticationError preserving an Error message", () => {
    const mapped = mapVeltError(
      Object.assign(new Error("bad token"), { status: 401 }),
      { action: "post comment" },
    );
    expect(mapped).toBeInstanceOf(AuthenticationError);
    expect(mapped.message).toBe("bad token");
  });

  it("maps 403 to PermissionError carrying the action", () => {
    const mapped = mapVeltError({ status: 403 }, { action: "delete comment" });
    expect(mapped).toBeInstanceOf(PermissionError);
    expect((mapped as PermissionError).action).toBe("delete comment");
  });

  it("maps 404 to ResourceNotFoundError with type + id", () => {
    const mapped = mapVeltError(
      { status: 404 },
      { action: "fetch thread", resourceType: "thread", resourceId: "ann-1" },
    );
    expect(mapped).toBeInstanceOf(ResourceNotFoundError);
    expect((mapped as ResourceNotFoundError).resourceType).toBe("thread");
    expect((mapped as ResourceNotFoundError).resourceId).toBe("ann-1");
  });

  it("defaults the resource type to 'resource' for a 404 without one", () => {
    const mapped = mapVeltError({ status: 404 }, { action: "fetch" });
    expect((mapped as ResourceNotFoundError).resourceType).toBe("resource");
  });

  it("maps 429 to AdapterRateLimitError and preserves retryAfter", () => {
    const mapped = mapVeltError({ status: 429, retryAfter: 30 }, { action: "post comment" });
    expect(mapped).toBeInstanceOf(AdapterRateLimitError);
    expect((mapped as AdapterRateLimitError).retryAfter).toBe(30);
  });

  it("reads the status from a nested response object", () => {
    const mapped = mapVeltError({ response: { status: 401 } }, { action: "post comment" });
    expect(mapped).toBeInstanceOf(AuthenticationError);
  });

  it("maps a statusless Error to NetworkError preserving the original", () => {
    const original = new Error("ECONNREFUSED");
    const mapped = mapVeltError(original, { action: "post comment" });
    expect(mapped).toBeInstanceOf(NetworkError);
    expect((mapped as NetworkError).originalError).toBe(original);
  });

  it("falls back to a generic AdapterError for an unknown status", () => {
    const mapped = mapVeltError({ status: 500 }, { action: "post comment" });
    expect(mapped).toBeInstanceOf(AdapterError);
    expect(mapped.code).toBe("500");
  });

  it("uses the context action in the fallback message for opaque values", () => {
    const mapped = mapVeltError({ status: 500 }, { action: "post comment" });
    expect(mapped.message).toContain("post comment");
  });

  it("tags every mapped error with the velt adapter name", () => {
    expect(mapVeltError({ status: 401 }, { action: "x" }).adapter).toBe("velt");
  });
});

describe("notSupported", () => {
  it("returns a PermissionError combining action and hint", () => {
    const err = notSupported("addReaction", "requires a self-hosted backend");
    expect(err).toBeInstanceOf(PermissionError);
    expect(err.action).toContain("addReaction");
    expect(err.action).toContain("self-hosted");
  });
});
