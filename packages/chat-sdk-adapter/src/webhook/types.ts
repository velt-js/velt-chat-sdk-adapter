import type { VeltReactionAnnotation, VeltUser } from "../types.js";

/** Kinds of normalized webhook event the adapter acts on. */
export type VeltWebhookEventKind =
  | "comment.add"
  | "comment.update"
  | "comment.delete"
  | "comment.reaction_add"
  | "comment.reaction_delete"
  | "unknown";

/** A raw Velt comment as it appears inside a webhook payload. */
export interface VeltWebhookComment {
  commentId: number;
  commentText?: string;
  commentHtml?: string;
  from?: VeltUser;
  to?: VeltUser[];
  taggedUserContacts?: Array<{ text?: string; userId: string; contact?: VeltUser }>;
  createdAt?: number | string;
  lastUpdated?: number | string;
  editedAt?: number | string;
  isEdited?: boolean;
  status?: string;
}

/** The comment annotation (thread) container in a webhook payload. */
export interface VeltWebhookCommentAnnotation {
  annotationId: string;
  comments?: VeltWebhookComment[];
  from?: VeltUser;
}

/** Metadata block carrying document/organization identifiers. */
export interface VeltWebhookMetadata {
  // Basic (v1) webhooks carry these flat:
  documentId?: string;
  clientDocumentId?: string;
  organizationId?: string;
  clientOrganizationId?: string;
  // Advanced (v2) webhooks nest them:
  organization?: { organizationId?: string };
  document?: { documentId?: string; documentName?: string };
  pageInfo?: { url?: string; baseUrl?: string; title?: string };
}

/** Normalized webhook event produced by {@link parseVeltWebhook}. */
export interface VeltWebhookEvent {
  kind: VeltWebhookEventKind;
  /** The raw event/actionType string from Velt (for logging). */
  rawType: string;
  organizationId?: string;
  documentId?: string;
  annotationId?: string;
  /** Human-readable document name, if present. */
  documentName?: string;
  /** URL of the page the comment lives on. */
  documentUrl?: string;
  /** The text the comment is anchored to (text-editor / target element). */
  anchoredText?: string;
  /** The comment that triggered the event (for comment.* events). */
  comment?: VeltWebhookComment;
  /** The user who performed the action. */
  actionUser?: VeltUser;
  /** Reaction details for reaction events. */
  reaction?: VeltReactionAnnotation;
  /** The full parsed payload (escape hatch). */
  raw: unknown;
}
