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
  documentId?: string;
  clientDocumentId?: string;
  organizationId?: string;
  clientOrganizationId?: string;
}

/** Normalized webhook event produced by {@link parseVeltWebhook}. */
export interface VeltWebhookEvent {
  kind: VeltWebhookEventKind;
  /** The raw event/actionType string from Velt (for logging). */
  rawType: string;
  organizationId?: string;
  documentId?: string;
  annotationId?: string;
  /** The comment that triggered the event (for comment.* events). */
  comment?: VeltWebhookComment;
  /** The user who performed the action. */
  actionUser?: VeltUser;
  /** Reaction details for reaction events. */
  reaction?: VeltReactionAnnotation;
  /** The full parsed payload (escape hatch). */
  raw: unknown;
}
