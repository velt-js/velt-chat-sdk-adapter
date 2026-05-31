import type { VeltReactionAnnotation, VeltUser } from "../types.js";
import type {
  VeltWebhookComment,
  VeltWebhookCommentAnnotation,
  VeltWebhookEvent,
  VeltWebhookEventKind,
  VeltWebhookMetadata,
} from "./types.js";

/** Map a Velt V2 event or V1 actionType string to a normalized kind. */
function classify(type: string): VeltWebhookEventKind {
  switch (type) {
    case "comment.add":
    case "added":
    case "newlyAdded":
    // A new thread's first comment arrives as comment_annotation.add; treat it
    // as a new message (its comment is in commentAnnotation.comments).
    case "comment_annotation.add":
      return "comment.add";
    case "comment.update":
    case "updated":
      return "comment.update";
    case "comment.delete":
    case "deleted":
      return "comment.delete";
    case "comment.reaction_add":
    case "reactionAdded":
      return "comment.reaction_add";
    case "comment.reaction_delete":
    case "reactionDeleted":
      return "comment.reaction_delete";
    default:
      return "unknown";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Parse a raw Velt webhook body (JSON string) into a normalized
 * {@link VeltWebhookEvent}. Handles both the Advanced (V2, `{ event, data }`)
 * and Basic (V1, top-level fields) payload shapes.
 */
export function parseVeltWebhook(body: string): VeltWebhookEvent {
  const payload = asRecord(JSON.parse(body));

  // V2 nests fields under `data`; V1 has them at the top level.
  const isV2 = typeof payload.event === "string";
  const rawType = (isV2 ? payload.event : payload.actionType) as string | undefined;
  const container = isV2 ? asRecord(payload.data) : payload;

  const annotation = asRecord(container.commentAnnotation) as unknown as VeltWebhookCommentAnnotation;
  const annotationRec = asRecord(container.commentAnnotation);
  const metadata = asRecord(container.metadata) as VeltWebhookMetadata;
  const actionUser = container.actionUser as VeltUser | undefined;

  // Document context — generic across any Velt document. The text a comment is
  // anchored to lives on the annotation (text-editor config or target element);
  // doc name/url come from metadata (v2) or the annotation's pageInfo.
  const anchoredText =
    (asRecord(asRecord(annotationRec.context).textEditorConfig).text as string | undefined) ??
    (asRecord(annotationRec.targetElement).targetText as string | undefined);
  const documentName = metadata.document?.documentName ?? metadata.pageInfo?.title;
  const documentUrl =
    metadata.pageInfo?.url ?? (asRecord(annotationRec.pageInfo).url as string | undefined);

  const targetComment =
    (container.targetComment as VeltWebhookComment | undefined) ??
    lastComment(annotation);

  const reaction =
    (asRecord(container.reactionAnnotation) as VeltReactionAnnotation) ??
    (asRecord(container.reaction) as VeltReactionAnnotation);

  return {
    kind: classify(rawType ?? ""),
    rawType: rawType ?? "",
    // Basic (v1) carries org/doc flat; Advanced (v2) nests them under
    // metadata.organization / metadata.document.
    organizationId:
      metadata.organizationId ??
      metadata.clientOrganizationId ??
      metadata.organization?.organizationId,
    documentId:
      metadata.documentId ??
      metadata.clientDocumentId ??
      metadata.document?.documentId,
    documentName,
    documentUrl,
    anchoredText,
    annotationId: annotation.annotationId,
    comment: targetComment,
    actionUser,
    reaction: hasReactionData(reaction) ? reaction : undefined,
    raw: payload,
  };
}

function lastComment(
  annotation: VeltWebhookCommentAnnotation,
): VeltWebhookComment | undefined {
  const comments = annotation.comments;
  if (Array.isArray(comments) && comments.length > 0) {
    return comments[comments.length - 1];
  }
  return undefined;
}

function hasReactionData(reaction: VeltReactionAnnotation): boolean {
  return Boolean(reaction && (reaction.icon || reaction.iconEmoji || reaction.annotationId));
}
