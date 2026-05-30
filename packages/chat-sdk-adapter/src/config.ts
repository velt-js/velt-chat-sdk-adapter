import { ValidationError } from "@chat-adapter/shared";
import { ADAPTER_NAME } from "./errors.js";
import { noopLogger } from "./logger.js";
import type { VeltAdapterConfig, ResolvedVeltConfig } from "./types.js";

function env(name: string): string | undefined {
  const value =
    typeof process !== "undefined" && process.env ? process.env[name] : undefined;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Merge explicit config with environment-variable fallbacks, validate required
 * fields, and derive the backend mode. Throws {@link ValidationError} when a
 * required credential is missing.
 */
export function resolveConfig(
  input: Partial<VeltAdapterConfig> & { logger?: VeltAdapterConfig["logger"] } = {},
): ResolvedVeltConfig {
  const apiKey = input.apiKey ?? env("VELT_API_KEY");
  const authToken = input.authToken ?? env("VELT_AUTH_TOKEN");
  const webhookSecret = input.webhookSecret ?? env("VELT_WEBHOOK_SECRET");
  const botUserId = input.botUserId ?? env("VELT_BOT_USER_ID");
  const botUserName = input.botUserName ?? env("VELT_BOT_USER_NAME");
  const organizationId = input.organizationId ?? env("VELT_ORGANIZATION_ID");

  const missing: string[] = [];
  if (!apiKey) missing.push("apiKey (or VELT_API_KEY)");
  if (!webhookSecret) missing.push("webhookSecret (or VELT_WEBHOOK_SECRET)");
  if (!botUserId) missing.push("botUserId (or VELT_BOT_USER_ID)");
  if (!botUserName) missing.push("botUserName (or VELT_BOT_USER_NAME)");

  if (missing.length > 0) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Missing required Velt adapter config: ${missing.join(", ")}.`,
    );
  }

  return {
    apiKey: apiKey!,
    authToken,
    webhookSecret: webhookSecret!,
    webhookVersion: input.webhookVersion ?? "v2",
    botUserId: botUserId!,
    botUserName: botUserName!,
    organizationId,
    resolveUsers: input.resolveUsers,
    selfHostingConfig: input.selfHostingConfig,
    backend: input.selfHostingConfig ? "self-hosted" : "managed",
    logger: input.logger ?? noopLogger,
  };
}
