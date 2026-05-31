import { describe, expect, it } from "vitest";
import { parseVeltWebhook } from "../webhook/parse.js";

describe("parseVeltWebhook", () => {
  it("parses a V2 comment.add payload", () => {
    const body = JSON.stringify({
      event: "comment.add",
      data: {
        commentAnnotation: { annotationId: "ann-1", comments: [] },
        targetComment: { commentId: 99, commentText: "hi", from: { userId: "u1", name: "Alice" } },
        metadata: { organizationId: "org-1", documentId: "doc-1" },
        actionUser: { userId: "u1", name: "Alice" },
      },
    });
    const event = parseVeltWebhook(body);
    expect(event.kind).toBe("comment.add");
    expect(event.organizationId).toBe("org-1");
    expect(event.documentId).toBe("doc-1");
    expect(event.annotationId).toBe("ann-1");
    expect(event.comment?.commentId).toBe(99);
  });

  it("parses a V1 'added' payload with top-level fields", () => {
    const body = JSON.stringify({
      actionType: "added",
      notificationSource: "comment",
      commentAnnotation: {
        annotationId: "ann-2",
        comments: [{ commentId: 5, commentText: "reply", from: { userId: "u2" } }],
      },
      metadata: { organizationId: "org-2", documentId: "doc-2" },
      actionUser: { userId: "u2" },
    });
    const event = parseVeltWebhook(body);
    expect(event.kind).toBe("comment.add");
    expect(event.annotationId).toBe("ann-2");
    expect(event.comment?.commentId).toBe(5);
  });

  it("classifies reaction events and extracts the emoji", () => {
    const body = JSON.stringify({
      event: "comment.reaction_add",
      data: {
        commentAnnotation: { annotationId: "ann-3" },
        targetComment: { commentId: 7 },
        reactionAnnotation: { annotationId: "r1", icon: "RAISED_HANDS" },
        metadata: { organizationId: "org-3", documentId: "doc-3" },
        actionUser: { userId: "u3" },
      },
    });
    const event = parseVeltWebhook(body);
    expect(event.kind).toBe("comment.reaction_add");
    expect(event.reaction?.icon).toBe("RAISED_HANDS");
  });

  it("classifies unknown events", () => {
    const event = parseVeltWebhook(JSON.stringify({ event: "comment_annotation.assign", data: {} }));
    expect(event.kind).toBe("unknown");
  });

  it("extracts org/doc from the Advanced (v2) NESTED metadata shape", () => {
    // Real-world Velt Advanced webhook: metadata.organization.organizationId
    // and metadata.document.documentId (NOT flat).
    const body = JSON.stringify({
      event: "comment.add",
      source: "comment",
      data: {
        actionUser: { userId: "user-00ecy7ez", name: "Alex Miller" },
        commentAnnotation: { annotationId: "NHR5sMWU7YmTv2HJ1nVC", comments: [] },
        targetComment: {
          commentId: 903108,
          commentText: "@Velt Bot yo!",
          from: { userId: "user-00ecy7ez", name: "Alex Miller" },
          to: [{ userId: "velt-bot", name: "Velt Bot" }],
          taggedUserContacts: [{ userId: "velt-bot", text: "@Velt Bot" }],
        },
        metadata: {
          apiKey: "6xTcUFtlYAlCdh11zrKB",
          organization: { organizationId: "sample-apps-demo-org" },
          document: { documentId: "doc-tiptap-123", documentName: "Tiptap Editor" },
        },
      },
    });
    const event = parseVeltWebhook(body);
    expect(event.kind).toBe("comment.add");
    expect(event.organizationId).toBe("sample-apps-demo-org");
    expect(event.documentId).toBe("doc-tiptap-123");
    expect(event.annotationId).toBe("NHR5sMWU7YmTv2HJ1nVC");
    expect(event.comment?.commentId).toBe(903108);
    expect(event.comment?.to?.[0]?.userId).toBe("velt-bot");
  });

  it("treats comment_annotation.add as a new message (new-thread mention)", () => {
    const body = JSON.stringify({
      event: "comment_annotation.add",
      data: {
        commentAnnotation: {
          annotationId: "ann-new",
          comments: [
            { commentId: 1, commentText: "@Velt Bot hi", from: { userId: "u1" }, to: [{ userId: "velt-bot" }] },
          ],
        },
        metadata: {
          organization: { organizationId: "org-1" },
          document: { documentId: "doc-1" },
        },
      },
    });
    const event = parseVeltWebhook(body);
    expect(event.kind).toBe("comment.add");
    expect(event.documentId).toBe("doc-1");
    expect(event.comment?.commentId).toBe(1);
  });
});
