import type { UserInfo } from "chat";
import type { Logger } from "./logger.js";

/**
 * Decoded Velt thread identifier.
 *
 * A Velt "thread" is a comment annotation, which lives inside a document, which
 * lives inside an organization. All three are needed to address it via the REST
 * API, so all three are encoded into the Chat SDK thread-id string.
 */
export interface VeltThreadId {
  organizationId: string;
  documentId: string;
  annotationId: string;
}

/** A Velt user as it appears on comments and webhook payloads. */
export interface VeltUser {
  userId: string;
  name?: string;
  email?: string;
  photoUrl?: string;
  color?: string;
  textColor?: string;
  organizationId?: string;
  isAdmin?: boolean;
}

/** An @-mention recovered from a Velt comment. */
export interface VeltTaggedContact {
  /** The literal mention text, e.g. "@Jim Halpert". */
  text?: string;
  userId: string;
  contact?: VeltUser;
}

/** A reaction annotation attached to a Velt comment. */
export interface VeltReactionAnnotation {
  annotationId?: string;
  /** Named icon, e.g. "RAISED_HANDS". */
  icon?: string;
  /** Unicode emoji, e.g. "👍". */
  iconEmoji?: string;
  commentAnnotationId?: string;
  fromUsers?: Array<{ from?: VeltUser; lastUpdated?: number | string }>;
  lastUpdated?: number | string;
}

/**
 * The Chat SDK `TRawMessage` for Velt: a Velt comment with its parent annotation
 * context denormalized in, so a single raw message is self-describing and
 * `parseMessage(raw)` alone can reconstruct the thread id.
 */
export interface VeltRawMessage {
  commentId: number;
  commentText?: string;
  commentHtml?: string;
  from?: VeltUser;
  /** Users @-mentioned in this comment. */
  to?: VeltUser[];
  taggedUserContacts?: VeltTaggedContact[];
  createdAt?: number | string;
  lastUpdated?: number | string;
  editedAt?: number | string;
  isEdited?: boolean;
  reactionAnnotations?: VeltReactionAnnotation[];

  // --- denormalized thread context ---
  organizationId: string;
  documentId: string;
  annotationId: string;

  // --- document context (when available from the webhook) ---
  /** Human-readable document name. */
  documentName?: string;
  /** URL of the page the comment lives on. */
  documentUrl?: string;
  /** The text the comment is anchored to. */
  anchoredText?: string;
}

/**
 * Result entry returned by {@link VeltAdapterConfig.resolveUsers}. Compatible
 * with the Chat SDK `UserInfo`, but every field is optional so callers can
 * return a partial record (mirrors the Liveblocks adapter's `resolveUsers`).
 */
export type ResolvedUserInfo =
  | (Partial<UserInfo> & { name?: string })
  | null
  | undefined;

/** Resolver that turns Velt user ids into display info. */
export type ResolveUsersFn = (args: {
  userIds: string[];
}) => Promise<ResolvedUserInfo[]> | ResolvedUserInfo[];

/**
 * Configuration for a self-hosted Velt data backend (MongoDB). Required to
 * enable reaction writes (`addReaction`/`removeReaction`); the managed Velt
 * backend has no REST endpoint for writing reactions.
 */
export interface VeltSelfHostingConfig {
  /**
   * A pre-initialized `@veltdev/node` self-hosting reactions service, or a
   * factory returning one. Kept intentionally loose to avoid a hard dependency
   * on the self-hosting types when the managed backend is used.
   */
  reactionsService: unknown;
}

export type WebhookVersion = "v2" | "v1";

/** Public configuration for {@link createVeltAdapter}. */
export interface VeltAdapterConfig {
  /** Velt API key. Falls back to `process.env.VELT_API_KEY`. */
  apiKey: string;
  /**
   * Velt auth token used to write as the bot. Falls back to
   * `process.env.VELT_AUTH_TOKEN`. If omitted, the adapter generates one for
   * `botUserId` via the Velt auth API and refreshes it on expiry.
   */
  authToken?: string;
  /**
   * Webhook signing secret. For v2 this is the Svix-style `whsec_...` secret;
   * for v1 it is the Console auth token. Falls back to
   * `process.env.VELT_WEBHOOK_SECRET`.
   */
  webhookSecret: string;
  /** Which Velt webhook system to verify. Defaults to `"v2"`. */
  webhookVersion?: WebhookVersion;
  /** The bot's Velt user id. */
  botUserId: string;
  /** The bot's display name (used for @-mention detection and as author name). */
  botUserName: string;
  /**
   * Default organization id, used when a thread id / webhook does not carry one.
   * Falls back to `process.env.VELT_ORGANIZATION_ID`.
   */
  organizationId?: string;
  /** Resolve user ids to display info for mentions/authors. */
  resolveUsers?: ResolveUsersFn;
  /** Enables reaction writes via a self-hosted backend. */
  selfHostingConfig?: VeltSelfHostingConfig;
  /** Optional logger. Defaults to a no-op. */
  logger?: Logger;
}

/** Backend mode, derived from whether a self-hosting config is supplied. */
export type VeltBackend = "managed" | "self-hosted";

/** Config after defaults/env-vars are applied and required fields validated. */
export interface ResolvedVeltConfig {
  apiKey: string;
  authToken?: string;
  webhookSecret: string;
  webhookVersion: WebhookVersion;
  botUserId: string;
  botUserName: string;
  organizationId?: string;
  resolveUsers?: ResolveUsersFn;
  selfHostingConfig?: VeltSelfHostingConfig;
  backend: VeltBackend;
  logger: Logger;
}
