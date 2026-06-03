import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVeltAdapter } from "../factory.js";
import { VeltAdapter } from "../adapter.js";
import type { ChatInstance } from "chat";
import type { VeltRawMessage } from "../types.js";

const BASE_CONFIG = {
  apiKey: "test-key",
  authToken: "test-token",
  webhookSecret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  botUserId: "velt-bot",
  botUserName: "Velt Bot",
  organizationId: "org-1",
};

function makeAdapter(overrides: Partial<typeof BASE_CONFIG> = {}): VeltAdapter {
  return createVeltAdapter({ ...BASE_CONFIG, ...overrides });
}

function fakeChat(): ChatInstance & {
  processMessage: ReturnType<typeof vi.fn>;
  processReaction: ReturnType<typeof vi.fn>;
} {
  return {
    processMessage: vi.fn().mockResolvedValue(undefined),
    processReaction: vi.fn(),
    getLogger: () => console,
  } as unknown as ChatInstance & {
    processMessage: ReturnType<typeof vi.fn>;
    processReaction: ReturnType<typeof vi.fn>;
  };
}

function rawComment(partial: Partial<VeltRawMessage> = {}): VeltRawMessage {
  return {
    commentId: 42,
    commentText: "Hello there",
    commentHtml: "<p>Hello there</p>",
    from: { userId: "user-1", name: "Alice" },
    createdAt: 1_700_000_000_000,
    organizationId: "org-1",
    documentId: "doc-1",
    annotationId: "ann-1",
    ...partial,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("config / factory", () => {
  it("throws ValidationError when required config is missing", () => {
    expect(() => createVeltAdapter({ apiKey: "x" })).toThrow(/Missing required Velt adapter config/);
  });

  it("exposes name, userName, botUserId", () => {
    const adapter = makeAdapter();
    expect(adapter.name).toBe("velt");
    expect(adapter.userName).toBe("Velt Bot");
    expect(adapter.botUserId).toBe("velt-bot");
  });
});

describe("thread id encoding", () => {
  it("round-trips a thread id", () => {
    const adapter = makeAdapter();
    const id = adapter.encodeThreadId({ organizationId: "o:1", documentId: "d/2", annotationId: "a 3" });
    expect(id.startsWith("velt:")).toBe(true);
    expect(adapter.decodeThreadId(id)).toEqual({
      organizationId: "o:1",
      documentId: "d/2",
      annotationId: "a 3",
    });
  });

  it("derives the channel id from the thread id", () => {
    const adapter = makeAdapter();
    const id = adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" });
    expect(adapter.channelIdFromThreadId(id)).toBe("velt:org-1:doc-1");
  });

  it("throws on a malformed thread id", () => {
    const adapter = makeAdapter();
    expect(() => adapter.decodeThreadId("slack:foo:bar")).toThrow(/Invalid Velt thread id/);
  });
});

describe("parseMessage", () => {
  it("maps a Velt comment to a normalized Message", () => {
    const adapter = makeAdapter();
    const msg = adapter.parseMessage(rawComment());
    expect(msg.id).toBe("42");
    expect(msg.text).toContain("Hello there");
    expect(msg.author.userId).toBe("user-1");
    expect(msg.author.isMe).toBe(false);
    expect(msg.metadata.dateSent).toBeInstanceOf(Date);
    expect(msg.isMention).toBe(false);
  });

  it("marks the bot as author when the comment is from the bot", () => {
    const adapter = makeAdapter();
    const msg = adapter.parseMessage(rawComment({ from: { userId: "velt-bot", name: "Velt Bot" } }));
    expect(msg.author.isMe).toBe(true);
    expect(msg.author.isBot).toBe(true);
  });

  it("flags isMention when the bot is tagged", () => {
    const adapter = makeAdapter();
    const msg = adapter.parseMessage(rawComment({ to: [{ userId: "velt-bot" }] }));
    expect(msg.isMention).toBe(true);
  });
});

describe("postMessage", () => {
  it("posts a reply via the Velt REST API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { status: "success", data: [123] } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = makeAdapter();
    const threadId = adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" });
    const result = await adapter.postMessage(threadId, "Hi from the bot");

    expect(result.id).toBe("123");
    expect(result.threadId).toBe(threadId);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v2/commentannotations/comments/add");
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.data.commentData[0].from.userId).toBe("velt-bot");
    expect(sentBody.data.commentData[0].commentText).toContain("Hi from the bot");
  });
});

describe("fetchMessages", () => {
  it("fetches the whole thread via the annotation endpoint (no author filter)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            status: "success",
            data: [
              {
                annotationId: "ann-1",
                comments: [
                  { commentId: 1, commentText: "hi", from: { userId: "user-1", name: "Alice" }, createdAt: 1 },
                  { commentId: 2, commentText: "@Velt Bot help", from: { userId: "user-1" }, to: [{ userId: "velt-bot" }], createdAt: 2 },
                ],
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = makeAdapter();
    const threadId = adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" });
    const result = await adapter.fetchMessages(threadId);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v2/commentannotations/get");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.text).toContain("hi");
    expect(result.messages[1]!.isMention).toBe(true);
  });
});

function stubFetch(data: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ result: { status: "success", data } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchMessage", () => {
  const annotationData = [
    {
      annotationId: "ann-1",
      comments: [
        { commentId: 1, commentText: "first", from: { userId: "user-1" }, createdAt: 1 },
        { commentId: 2, commentText: "second", from: { userId: "user-1" }, createdAt: 2 },
      ],
    },
  ];

  it("returns the matching comment by id", async () => {
    stubFetch(annotationData);
    const adapter = makeAdapter();
    const threadId = adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" });
    const msg = await adapter.fetchMessage(threadId, "2");
    expect(msg?.id).toBe("2");
    expect(msg?.text).toContain("second");
  });

  it("returns null when no comment matches", async () => {
    stubFetch(annotationData);
    const adapter = makeAdapter();
    const threadId = adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" });
    expect(await adapter.fetchMessage(threadId, "999")).toBeNull();
  });
});

describe("listThreads / fetchChannelMessages", () => {
  const annotations = [
    {
      annotationId: "ann-1",
      comments: [
        { commentId: 1, commentText: "root one", from: { userId: "user-1" }, createdAt: 1 },
        { commentId: 2, commentText: "reply", from: { userId: "user-2" }, createdAt: 2 },
      ],
    },
    {
      annotationId: "ann-2",
      comments: [{ commentId: 3, commentText: "root two", from: { userId: "user-3" }, createdAt: 3 }],
    },
  ];

  it("listThreads maps annotations to thread summaries", async () => {
    const fetchMock = stubFetch(annotations);
    const adapter = makeAdapter();
    const result = await adapter.listThreads("velt:org-1:doc-1");
    expect(fetchMock.mock.calls[0]![0]).toContain("/v2/commentannotations/get");
    expect(result.threads).toHaveLength(2);
    expect(result.threads[0]!.id).toBe(
      adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" }),
    );
    expect(result.threads[0]!.rootMessage.text).toContain("root one");
    expect(result.threads[0]!.replyCount).toBe(1);
    expect(result.threads[1]!.replyCount).toBe(0);
  });

  it("fetchChannelMessages returns the root message of each thread", async () => {
    stubFetch(annotations);
    const adapter = makeAdapter();
    const result = await adapter.fetchChannelMessages("velt:org-1:doc-1");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.text).toContain("root one");
    expect(result.messages[1]!.text).toContain("root two");
  });

  it("rejects a malformed channel id", async () => {
    const adapter = makeAdapter();
    await expect(adapter.listThreads("slack:org:doc")).rejects.toThrow(/Invalid Velt channel id/);
  });
});

describe("fetchChannelInfo", () => {
  it("maps document metadata to channel info", async () => {
    const fetchMock = stubFetch([{ id: "doc-1", documentName: "My Document", accessType: "public" }]);
    const adapter = makeAdapter();
    const info = await adapter.fetchChannelInfo("velt:org-1:doc-1");
    expect(fetchMock.mock.calls[0]![0]).toContain("/v2/organizations/documents/get");
    expect(info.id).toBe("velt:org-1:doc-1");
    expect(info.name).toBe("My Document");
    expect(info.metadata.documentId).toBe("doc-1");
  });
});

describe("postChannelMessage", () => {
  it("creates a new annotation with an initial comment", async () => {
    const fetchMock = stubFetch({ annotationId: "new-ann", commentIds: [555] });
    const adapter = makeAdapter();
    const result = await adapter.postChannelMessage("velt:org-1:doc-1", "New thread root");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v2/commentannotations/add");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.data.commentAnnotations[0].commentData[0].from.userId).toBe("velt-bot");
    expect(body.data.commentAnnotations[0].commentData[0].commentText).toContain("New thread root");
    expect(result.id).toBe("555");
    expect(result.threadId).toBe(
      adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "new-ann" }),
    );
  });
});

describe("attachments", () => {
  it("parses inbound comment attachments into Chat SDK attachments", () => {
    const adapter = makeAdapter();
    const msg = adapter.parseMessage(
      rawComment({
        attachments: [
          { name: "diagram.png", url: "https://files/diagram.png", type: "image", mimeType: "image/png", size: 2048 },
          { name: "notes.pdf", url: "https://files/notes.pdf", type: "document", mimeType: "application/pdf" },
        ],
      }),
    );
    expect(msg.attachments).toHaveLength(2);
    expect(msg.attachments[0]).toMatchObject({ type: "image", url: "https://files/diagram.png", name: "diagram.png" });
    expect(msg.attachments[1]!.type).toBe("file");
  });
});

describe("reactions", () => {
  it("throws on the managed backend", async () => {
    const adapter = makeAdapter();
    const threadId = adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" });
    await expect(adapter.addReaction(threadId, "42", "thumbsup")).rejects.toThrow(/managed Velt backend/);
  });

  it("delegates to a self-hosted reactions service when configured", async () => {
    const saveReactions = vi.fn().mockResolvedValue(undefined);
    const adapter = createVeltAdapter({
      ...BASE_CONFIG,
      selfHostingConfig: { reactionsService: { saveReactions } },
    });
    const threadId = adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" });
    await adapter.addReaction(threadId, "42", "thumbsup");
    expect(saveReactions).toHaveBeenCalledOnce();
  });
});

describe("handleWebhook", () => {
  function signedV2Request(payload: unknown): { request: Request; body: string } {
    const body = JSON.stringify(payload);
    const id = "msg_1";
    const ts = Math.floor(Date.now() / 1000);
    const secretBytes = Buffer.from(BASE_CONFIG.webhookSecret.replace(/^whsec_/, ""), "base64");
    const sig = createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64");
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "webhook-id": id,
        "webhook-timestamp": String(ts),
        "webhook-signature": `v1,${sig}`,
      },
      body,
    });
    return { request, body };
  }

  it("returns 401 for an invalid signature", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(fakeChat());
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "webhook-id": "x", "webhook-timestamp": "1", "webhook-signature": "v1,bad" },
      body: "{}",
    });
    const res = await adapter.handleWebhook(request);
    expect(res.status).toBe(401);
  });

  it("dispatches a comment.add to processMessage and returns 200", async () => {
    const adapter = makeAdapter();
    const chat = fakeChat();
    await adapter.initialize(chat);

    const { request } = signedV2Request({
      event: "comment.add",
      data: {
        commentAnnotation: { annotationId: "ann-1" },
        targetComment: { commentId: 7, commentText: "@Velt Bot hi", from: { userId: "user-1", name: "Alice" } },
        metadata: { organizationId: "org-1", documentId: "doc-1" },
        actionUser: { userId: "user-1", name: "Alice" },
      },
    });

    const res = await adapter.handleWebhook(request);
    expect(res.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId, message] = chat.processMessage.mock.calls[0]!;
    expect(threadId).toBe(adapter.encodeThreadId({ organizationId: "org-1", documentId: "doc-1", annotationId: "ann-1" }));
    expect((message as { text: string }).text).toContain("hi");
  });

  it("ignores the bot's own comments to avoid loops", async () => {
    const adapter = makeAdapter();
    const chat = fakeChat();
    await adapter.initialize(chat);

    const { request } = signedV2Request({
      event: "comment.add",
      data: {
        commentAnnotation: { annotationId: "ann-1" },
        targetComment: { commentId: 8, commentText: "bot reply", from: { userId: "velt-bot", name: "Velt Bot" } },
        metadata: { organizationId: "org-1", documentId: "doc-1" },
        actionUser: { userId: "velt-bot" },
      },
    });

    const res = await adapter.handleWebhook(request);
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("dispatches reaction events to processReaction", async () => {
    const adapter = makeAdapter();
    const chat = fakeChat();
    await adapter.initialize(chat);

    const { request } = signedV2Request({
      event: "comment.reaction_add",
      data: {
        commentAnnotation: { annotationId: "ann-1" },
        targetComment: { commentId: 9 },
        reactionAnnotation: { annotationId: "r1", iconEmoji: "👍", icon: "THUMBSUP" },
        metadata: { organizationId: "org-1", documentId: "doc-1" },
        actionUser: { userId: "user-1", name: "Alice" },
      },
    });

    const res = await adapter.handleWebhook(request);
    expect(res.status).toBe(200);
    expect(chat.processReaction).toHaveBeenCalledOnce();
    const [event] = chat.processReaction.mock.calls[0]!;
    expect((event as { added: boolean }).added).toBe(true);
    expect((event as { messageId: string }).messageId).toBe("9");
  });
});
