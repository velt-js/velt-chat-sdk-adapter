import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyVeltWebhook } from "../webhook/verify.js";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

function signV2(body: string, id: string, ts: number): string {
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64");
}

function v2Request(body: string, headers: Record<string, string>): Request {
  return new Request("https://example.com/webhook", { method: "POST", headers });
}

describe("verifyVeltWebhook (v2)", () => {
  const body = JSON.stringify({ event: "comment.add", data: {} });
  const id = "msg_123";
  const ts = 1_700_000_000;
  const now = ts * 1000;

  it("accepts a valid signature", () => {
    const sig = signV2(body, id, ts);
    const request = v2Request(body, {
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sig}`,
    });
    expect(() => verifyVeltWebhook({ request, body, secret: SECRET, version: "v2", now })).not.toThrow();
  });

  it("accepts when one of multiple signatures matches", () => {
    const sig = signV2(body, id, ts);
    const request = v2Request(body, {
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,bogus v1,${sig}`,
    });
    expect(() => verifyVeltWebhook({ request, body, secret: SECRET, version: "v2", now })).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const sig = signV2(body, id, ts);
    const request = v2Request("tampered", {
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sig}`,
    });
    expect(() => verifyVeltWebhook({ request, body: "tampered", secret: SECRET, version: "v2", now })).toThrow();
  });

  it("rejects an out-of-tolerance timestamp", () => {
    const sig = signV2(body, id, ts);
    const request = v2Request(body, {
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sig}`,
    });
    const farFuture = (ts + 10 * 60) * 1000;
    expect(() =>
      verifyVeltWebhook({ request, body, secret: SECRET, version: "v2", now: farFuture }),
    ).toThrow();
  });

  it("rejects missing headers", () => {
    const request = v2Request(body, {});
    expect(() => verifyVeltWebhook({ request, body, secret: SECRET, version: "v2", now })).toThrow();
  });
});

describe("verifyVeltWebhook (v1)", () => {
  const body = JSON.stringify({ actionType: "added" });

  it("accepts a matching Basic auth token", () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { authorization: "Basic my-token" },
    });
    expect(() => verifyVeltWebhook({ request, body, secret: "my-token", version: "v1" })).not.toThrow();
  });

  it("rejects a mismatched token", () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { authorization: "Basic wrong" },
    });
    expect(() => verifyVeltWebhook({ request, body, secret: "my-token", version: "v1" })).toThrow();
  });
});
