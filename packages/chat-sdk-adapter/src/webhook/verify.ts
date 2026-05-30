import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthenticationError } from "@chat-adapter/shared";
import { ADAPTER_NAME } from "../errors.js";
import type { WebhookVersion } from "../types.js";

/** Max allowed difference between the webhook timestamp and now (5 minutes). */
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Velt **Advanced (V2)** webhook signature (Svix-compatible).
 *
 * Signed content is `${id}.${timestamp}.${body}`, HMAC-SHA256 with the
 * base64-decoded secret (the part after the `whsec_` prefix). The
 * `webhook-signature` header is a space-separated list of `v1,<base64sig>`.
 */
export function verifyV2Signature(args: {
  body: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  secret: string;
  now?: number;
}): void {
  const { body, webhookId, webhookTimestamp, webhookSignature, secret } = args;

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw new AuthenticationError(
      ADAPTER_NAME,
      "Missing webhook-id, webhook-timestamp, or webhook-signature header.",
    );
  }

  const timestamp = Number(webhookTimestamp);
  if (!Number.isFinite(timestamp)) {
    throw new AuthenticationError(ADAPTER_NAME, "Invalid webhook-timestamp header.");
  }
  const now = Math.floor((args.now ?? Date.now()) / 1000);
  if (Math.abs(now - timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) {
    throw new AuthenticationError(ADAPTER_NAME, "Webhook timestamp outside tolerance.");
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  // The header may contain multiple space-separated `v1,<sig>` entries.
  const candidates = webhookSignature.split(" ").map((part) => {
    const comma = part.indexOf(",");
    return comma === -1 ? part : part.slice(comma + 1);
  });

  if (!candidates.some((sig) => safeEqual(sig, expected))) {
    throw new AuthenticationError(ADAPTER_NAME, "Webhook signature verification failed.");
  }
}

/**
 * Verify a Velt **Basic (V1)** webhook auth token. Velt sends the configured
 * token in the `Authorization: Basic <token>` header.
 */
export function verifyV1Auth(args: { authorization: string | null; secret: string }): void {
  const { authorization, secret } = args;
  if (!authorization) {
    throw new AuthenticationError(ADAPTER_NAME, "Missing Authorization header.");
  }
  const token = authorization.replace(/^Basic\s+/i, "");
  const expected = secret.replace(/^Basic\s+/i, "");
  if (!safeEqual(token, expected)) {
    throw new AuthenticationError(ADAPTER_NAME, "Webhook auth token mismatch.");
  }
}

/**
 * Verify an incoming webhook `Request` (body already read) against the
 * configured webhook version and secret. Throws {@link AuthenticationError} on
 * failure.
 */
export function verifyVeltWebhook(args: {
  request: Request;
  body: string;
  secret: string;
  version: WebhookVersion;
  now?: number;
}): void {
  const { request, body, secret, version, now } = args;
  if (version === "v1") {
    verifyV1Auth({ authorization: request.headers.get("authorization"), secret });
    return;
  }
  verifyV2Signature({
    body,
    webhookId: request.headers.get("webhook-id"),
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature: request.headers.get("webhook-signature"),
    secret,
    now,
  });
}
