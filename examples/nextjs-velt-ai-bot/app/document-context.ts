import type { VeltRawMessage } from "@veltdev/chat-sdk-adapter";

export type DocumentRef = Pick<
  VeltRawMessage,
  "documentId" | "documentName" | "documentUrl" | "anchoredText"
>;

/** Cap how much document text we feed the model, to keep prompts bounded. */
const MAX_CHARS = 6_000;
/** Give up on a slow fetch rather than holding up the reply. */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetch the FULL document content so the bot can answer about more than the
 * comment thread (e.g. "summarize this document").
 *
 * The Velt webhook only carries *lightweight* context — the document's title/URL
 * and the text a comment is anchored to. The full document text is NOT in the
 * webhook, so we retrieve it here.
 *
 * Default implementation: fetch `documentUrl` and extract its readable text.
 * This works for server-rendered / publicly-reachable documents. If your docs
 * are a client-only SPA (the URL returns an app shell, not content) or are
 * private, swap the body for one of:
 *   - read from your own database / CMS by `documentId`
 *   - read from Velt CRDT if you store the doc there (`POST /v2/crdt/...`)
 *
 * Returns `null` on any failure (missing URL, non-HTML, timeout, error), which
 * makes the bot fall back to the lightweight context — so a reply is never
 * blocked by this.
 */
export async function resolveDocumentContext(doc: DocumentRef): Promise<string | null> {
  if (!doc.documentUrl) return null;
  try {
    const html = await fetchWithTimeout(doc.documentUrl, FETCH_TIMEOUT_MS);
    if (!html) return null;
    const text = htmlToText(html);
    return text ? text.slice(0, MAX_CHARS) : null;
  } catch {
    return null;
  }
}

/** Fetch a URL as text, aborting if it takes too long; null on any non-HTML/error. */
async function fetchWithTimeout(url: string, ms: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/html,text/plain,*/*" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) return null;
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dependency-free readable-text extraction: drop comments, scripts, styles, and
 * other non-content elements, strip the remaining tags, decode common entities,
 * and collapse whitespace. Good enough for grounding; not a full HTML parser.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
