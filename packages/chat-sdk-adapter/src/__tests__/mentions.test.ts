import { describe, expect, it } from "vitest";
import { buildMentionFields, isBotMentioned, normalizeMentionTokens } from "../mentions.js";
import type { VeltRawMessage } from "../types.js";

const BOT_ID = "velt-bot";
const BOT_NAME = "Velt Bot";

function raw(partial: Partial<VeltRawMessage>): VeltRawMessage {
  return {
    commentId: 1,
    organizationId: "org",
    documentId: "doc",
    annotationId: "ann",
    ...partial,
  };
}

describe("isBotMentioned", () => {
  it("detects a mention via the structured `to` field", () => {
    expect(isBotMentioned(raw({ to: [{ userId: BOT_ID }] }), BOT_ID, BOT_NAME)).toBe(true);
  });

  it("detects a mention via taggedUserContacts", () => {
    expect(
      isBotMentioned(
        raw({ taggedUserContacts: [{ userId: BOT_ID, text: "@Velt Bot" }] }),
        BOT_ID,
        BOT_NAME,
      ),
    ).toBe(true);
  });

  it("detects a mention via taggedUserContacts contact id", () => {
    expect(
      isBotMentioned(
        raw({ taggedUserContacts: [{ userId: "x", contact: { userId: BOT_ID } }] }),
        BOT_ID,
        BOT_NAME,
      ),
    ).toBe(true);
  });

  it("falls back to scanning text for @BotName", () => {
    expect(isBotMentioned(raw({ commentText: "hey @Velt Bot please help" }), BOT_ID, BOT_NAME)).toBe(true);
  });

  it("returns false when the bot is not mentioned", () => {
    expect(
      isBotMentioned(raw({ commentText: "just a normal comment", to: [{ userId: "someone" }] }), BOT_ID, BOT_NAME),
    ).toBe(false);
  });
});

describe("normalizeMentionTokens", () => {
  it("replaces {{userId}} tokens with @Name from taggedUserContacts", () => {
    const r = raw({ taggedUserContacts: [{ userId: "u1", contact: { userId: "u1", name: "Alice" } }] });
    expect(normalizeMentionTokens("hey {{u1}} look", r)).toBe("hey @Alice look");
  });

  it("uses the extraNames map (e.g. the bot identity)", () => {
    expect(normalizeMentionTokens("{{velt-bot}} hi", raw({}), { "velt-bot": "Velt Bot" })).toBe(
      "@Velt Bot hi",
    );
  });

  it("falls back to the id when no name is known, and leaves token-free text alone", () => {
    expect(normalizeMentionTokens("hi {{u9}}", raw({}))).toBe("hi @u9");
    expect(normalizeMentionTokens("no tokens here", raw({}))).toBe("no tokens here");
  });
});

describe("buildMentionFields", () => {
  it("builds `to` and `taggedUserContacts` from users", () => {
    const fields = buildMentionFields([{ userId: "u1", name: "Alice" }]);
    expect(fields.to).toHaveLength(1);
    expect(fields.taggedUserContacts[0]).toMatchObject({ userId: "u1", text: "@Alice" });
  });
});
