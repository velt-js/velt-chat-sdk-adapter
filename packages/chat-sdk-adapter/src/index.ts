export { VeltAdapter } from "./adapter.js";
export { createVeltAdapter } from "./factory.js";
export { VeltFormatConverter } from "./format-converter.js";

export type {
  VeltAdapterConfig,
  VeltThreadId,
  VeltRawMessage,
  VeltUser,
  VeltTaggedContact,
  VeltReactionAnnotation,
  VeltSelfHostingConfig,
  ResolveUsersFn,
  ResolvedUserInfo,
  WebhookVersion,
} from "./types.js";
export type { Logger } from "./logger.js";
