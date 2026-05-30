import { describe, expect, it } from "vitest";
import { buildMentionFields, isBotMentioned } from "../mentions.js";
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

describe("buildMentionFields", () => {
  it("builds `to` and `taggedUserContacts` from users", () => {
    const fields = buildMentionFields([{ userId: "u1", name: "Alice" }]);
    expect(fields.to).toHaveLength(1);
    expect(fields.taggedUserContacts[0]).toMatchObject({ userId: "u1", text: "@Alice" });
  });
});
