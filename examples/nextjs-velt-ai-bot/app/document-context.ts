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
 * and the text a comment is anchored to. The full page/document text is NOT in
 * the webhook, so plug your own retrieval here. Ideas:
 *   - read it from your own database / CMS by `documentId`
 *   - fetch `documentUrl` and extract the text
 *   - read it from Velt CRDT if you store the doc there (`POST /v2/crdt/...`)
 *
 * Return `null` to use only the lightweight context (the default). This keeps the
 * bot generic: it works on any document, and gets smarter wherever you wire this.
 */
export async function resolveDocumentContext(doc: DocumentRef): Promise<string | null> {
  // Example (disabled by default):
  //   if (!doc.documentUrl) return null;
  //   const res = await fetch(doc.documentUrl);
  //   return extractReadableText(await res.text());
  void doc;
  return null;
}
