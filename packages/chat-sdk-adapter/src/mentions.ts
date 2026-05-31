import type { VeltRawMessage, VeltTaggedContact, VeltUser } from "./types.js";

/**
 * Determine whether the bot is @-mentioned in a Velt comment.
 *
 * Velt encodes mentions both structurally (`to` / `taggedUserContacts`, which
 * carry the user id) and visually (a `<span class="velt-mention">@Name</span>`
 * in `commentHtml`, which carries only the display name). We rely on the
 * structural fields first because they are authoritative, then fall back to a
 * text scan so detection never depends solely on HTML fidelity.
 */
export function isBotMentioned(raw: VeltRawMessage, botUserId: string, botUserName: string): boolean {
  if (raw.to?.some((u) => u.userId === botUserId)) return true;
  if (raw.taggedUserContacts?.some((t) => t.userId === botUserId || t.contact?.userId === botUserId)) {
    return true;
  }
  // Fallback: scan plain text for "@<botUserName>".
  const text = raw.commentText ?? "";
  const pattern = new RegExp(`@${escapeRegex(botUserName)}\\b`, "i");
  return pattern.test(text);
}

/**
 * Build the structured mention fields Velt needs to notify a mentioned user.
 * Posting only a `velt-mention` span in HTML does not notify the user — the
 * `to` and `taggedUserContacts` fields must also be set.
 */
export function buildMentionFields(users: VeltUser[]): {
  to: VeltUser[];
  taggedUserContacts: VeltTaggedContact[];
} {
  return {
    to: users,
    taggedUserContacts: users.map((u) => ({
      userId: u.userId,
      text: u.name ? `@${u.name}` : undefined,
      contact: u,
    })),
  };
}

/**
 * Replace Velt mention tokens (`{{userId}}`, as returned by the REST/history
 * API) with readable `@Name` text, so the plain text — and any LLM that reads
 * it — sees "@Velt Bot" rather than the raw token. Falls back to the user id
 * when no display name is known.
 */
export function normalizeMentionTokens(
  text: string,
  raw: VeltRawMessage,
  extraNames?: Record<string, string>,
): string {
  if (!text || !text.includes("{{")) return text;
  const nameById = new Map<string, string>(Object.entries(extraNames ?? {}));
  for (const t of raw.taggedUserContacts ?? []) {
    const name = t.contact?.name ?? t.text?.replace(/^@/, "");
    if (t.userId && name) nameById.set(t.userId, name);
  }
  for (const u of raw.to ?? []) {
    if (u.userId && u.name) nameById.set(u.userId, u.name);
  }
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, id: string) => `@${nameById.get(id) ?? id}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
