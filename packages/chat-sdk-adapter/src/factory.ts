import { VeltAdapter } from "./adapter.js";
import { resolveConfig } from "./config.js";
import type { VeltAdapterConfig } from "./types.js";

/**
 * Create a Velt Chat SDK adapter.
 *
 * Missing fields fall back to environment variables (`VELT_API_KEY`,
 * `VELT_AUTH_TOKEN`, `VELT_WEBHOOK_SECRET`, `VELT_BOT_USER_ID`,
 * `VELT_BOT_USER_NAME`, `VELT_ORGANIZATION_ID`). Throws `ValidationError` if a
 * required credential is missing.
 *
 * @example
 * ```ts
 * import { Chat } from "chat";
 * import { createVeltAdapter } from "@velt-js/chat-sdk-adapter";
 * import { createMemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "Velt Bot",
 *   adapters: {
 *     velt: createVeltAdapter({
 *       botUserId: "velt-bot",
 *       botUserName: "Velt Bot",
 *       resolveUsers: ({ userIds }) => userIds.map(getUser),
 *     }),
 *   },
 *   state: createMemoryState(),
 * });
 * ```
 */
export function createVeltAdapter(
  config?: Partial<VeltAdapterConfig> & { logger?: VeltAdapterConfig["logger"] },
): VeltAdapter {
  // Validate + apply env fallbacks eagerly so misconfiguration fails fast.
  const resolved = resolveConfig(config ?? {});
  return new VeltAdapter({
    apiKey: resolved.apiKey,
    authToken: resolved.authToken,
    webhookSecret: resolved.webhookSecret,
    webhookVersion: resolved.webhookVersion,
    botUserId: resolved.botUserId,
    botUserName: resolved.botUserName,
    organizationId: resolved.organizationId,
    resolveUsers: resolved.resolveUsers,
    selfHostingConfig: resolved.selfHostingConfig,
    logger: resolved.logger,
  });
}
