import type { VeltRawMessage } from "@veltdev/chat-sdk-adapter";

export type DocumentRef = Pick<
  VeltRawMessage,
  "documentId" | "documentName" | "documentUrl" | "anchoredText"
>;

/**
 * Optionally fetch the FULL document content, for answers that need more than the
 * comment thread (e.g. "summarize this document").
 *
 * The Velt webhook only carries *lightweight* context — the document's title/URL
 * and the text a comment is anchored to (`anchoredText`). The full document body
 * is NOT in the webhook, so plug your own retrieval here. Return `null` (the
 * default) to use only the lightweight context — the bot still gets the document
 * title and the highlighted text the comment sits on.
 *
 * To enable full-document context, wire ONE of these — whichever matches where
 * your document content actually lives:
 *   - **Velt CRDT** — `POST https://api.velt.dev/v2/crdt/get` with headers
 *     `x-velt-api-key` + `x-velt-auth-token` and `{ data: { organizationId,
 *     documentId } }`. Returns content ONLY if the editor stores it in Velt CRDT.
 *   - **Your own database / CMS** — look the content up by `doc.documentId`.
 *   - **The document URL** — fetch `doc.documentUrl` and extract the text. Works
 *     only for server-rendered / publicly-reachable docs.
 *
 * Note: a purely client-side editor whose content is hardcoded or ephemeral (never
 * persisted to a backend or CRDT) has nothing for a server to read — in that case
 * leave this as `null` and rely on `anchoredText`.
 */
export async function resolveDocumentContext(doc: DocumentRef): Promise<string | null> {
  void doc;
  return null;
}
