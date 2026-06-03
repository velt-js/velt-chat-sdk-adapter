import {
  BaseFormatConverter,
  getEmoji,
  Message,
  type Adapter,
  type AdapterPostableMessage,
  type Attachment,
  type Author,
  type ChannelInfo,
  type ChatInstance,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type ListThreadsOptions,
  type ListThreadsResult,
  type RawMessage,
  type ThreadInfo,
  type ThreadSummary,
  type UserInfo,
  type WebhookOptions,
} from "chat";
import { ValidationError } from "@chat-adapter/shared";
import { VeltRestClient, type VeltCommentInput } from "./client.js";
import { resolveConfig } from "./config.js";
import { ADAPTER_NAME, notSupported } from "./errors.js";
import { VeltFormatConverter } from "./format-converter.js";
import { buildMentionFields, isBotMentioned, normalizeMentionTokens } from "./mentions.js";
import { parseVeltWebhook } from "./webhook/parse.js";
import { verifyVeltWebhook } from "./webhook/verify.js";
import type {
  ResolvedVeltConfig,
  VeltAdapterConfig,
  VeltAttachment,
  VeltRawMessage,
  VeltThreadId,
  VeltUser,
} from "./types.js";

const THREAD_ID_PREFIX = "velt";

/** Minimal shape of a self-hosted reactions service (`@veltdev/node`). */
interface ReactionsService {
  saveReactions?(request: unknown): Promise<unknown>;
  deleteReaction?(request: unknown): Promise<unknown>;
}

/**
 * Chat SDK adapter for Velt comment threads.
 *
 * Maps the Chat SDK's thread/message model onto Velt's
 * Organization → Document → CommentAnnotation (thread) → comments (messages)
 * hierarchy, and drives the bot from Velt comment/reaction webhooks.
 */
export class VeltAdapter implements Adapter<VeltThreadId, VeltRawMessage> {
  readonly name = ADAPTER_NAME;
  readonly userName: string;
  readonly botUserId: string;

  private readonly config: ResolvedVeltConfig;
  private readonly client: VeltRestClient;
  private readonly converter: VeltFormatConverter;
  private chat: ChatInstance | null = null;

  constructor(config: VeltAdapterConfig) {
    this.config = resolveConfig(config);
    this.userName = this.config.botUserName;
    this.botUserId = this.config.botUserId;
    this.client = new VeltRestClient(this.config);
    this.converter = new VeltFormatConverter();
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  // --- Thread ID encoding ---------------------------------------------------

  encodeThreadId({ organizationId, documentId, annotationId }: VeltThreadId): string {
    return [
      THREAD_ID_PREFIX,
      encodeURIComponent(organizationId),
      encodeURIComponent(documentId),
      encodeURIComponent(annotationId),
    ].join(":");
  }

  decodeThreadId(threadId: string): VeltThreadId {
    const parts = threadId.split(":");
    if (parts.length !== 4 || parts[0] !== THREAD_ID_PREFIX) {
      throw new ValidationError(ADAPTER_NAME, `Invalid Velt thread id: ${threadId}`);
    }
    return {
      organizationId: decodeURIComponent(parts[1]!),
      documentId: decodeURIComponent(parts[2]!),
      annotationId: decodeURIComponent(parts[3]!),
    };
  }

  /** A Velt "channel" is a document; channel id is `velt:{org}:{doc}`. */
  channelIdFromThreadId(threadId: string): string {
    const { organizationId, documentId } = this.decodeThreadId(threadId);
    return [THREAD_ID_PREFIX, encodeURIComponent(organizationId), encodeURIComponent(documentId)].join(
      ":",
    );
  }

  /** Decode a `velt:{org}:{doc}` channel id back to its parts. */
  decodeChannelId(channelId: string): { organizationId: string; documentId: string } {
    const parts = channelId.split(":");
    if (parts.length !== 3 || parts[0] !== THREAD_ID_PREFIX) {
      throw new ValidationError(ADAPTER_NAME, `Invalid Velt channel id: ${channelId}`);
    }
    return {
      organizationId: decodeURIComponent(parts[1]!),
      documentId: decodeURIComponent(parts[2]!),
    };
  }

  // --- Messages -------------------------------------------------------------

  parseMessage(raw: VeltRawMessage): Message<VeltRawMessage> {
    const threadId = this.encodeThreadId({
      organizationId: raw.organizationId,
      documentId: raw.documentId,
      annotationId: raw.annotationId,
    });

    const html = raw.commentHtml ?? raw.commentText ?? "";
    const formatted = this.converter.toAst(html);
    const rawText = raw.commentText ?? this.converter.extractPlainText(html);
    // Convert {{userId}} mention tokens (from the REST/history API) to @Name.
    const text = normalizeMentionTokens(rawText, raw, { [this.botUserId]: this.userName });

    return new Message<VeltRawMessage>({
      id: String(raw.commentId),
      threadId,
      text,
      formatted,
      raw,
      author: this.toAuthor(raw.from),
      metadata: {
        dateSent: toDate(raw.createdAt),
        edited: Boolean(raw.isEdited),
        editedAt: raw.editedAt ? toDate(raw.editedAt) : undefined,
      },
      attachments: this.toAttachments(raw.attachments),
      isMention: isBotMentioned(raw, this.botUserId, this.userName),
      links: [],
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<VeltRawMessage>> {
    const ctx = this.decodeThreadId(threadId);
    const input = await this.toCommentInput(message);
    const ids = await this.client.addComments({ ...ctx, commentData: [input] });
    const commentId = ids[0] ?? input.commentId ?? 0;
    return {
      id: String(commentId),
      threadId,
      raw: this.client.toRawMessage({ ...input, commentId }, ctx),
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<VeltRawMessage>> {
    const ctx = this.decodeThreadId(threadId);
    const input = await this.toCommentInput(message);
    await this.client.updateComments({
      ...ctx,
      commentIds: [Number(messageId)],
      updatedData: {
        commentText: input.commentText,
        commentHtml: input.commentHtml,
        from: input.from,
      },
    });
    return {
      id: messageId,
      threadId,
      raw: this.client.toRawMessage({ ...input, commentId: Number(messageId) }, ctx),
    };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const ctx = this.decodeThreadId(threadId);
    await this.client.deleteComments({ ...ctx, commentIds: [Number(messageId)] });
  }

  async fetchMessages(threadId: string, options?: FetchOptions): Promise<FetchResult<VeltRawMessage>> {
    const ctx = this.decodeThreadId(threadId);
    // Fetch the whole thread (the annotation endpoint embeds all comments, with
    // no per-author filter — unlike comments/get).
    const raws = await this.client.getThreadComments(ctx);
    raws.sort((a, b) => toDate(a.createdAt).getTime() - toDate(b.createdAt).getTime());

    let selected = raws;
    if (options?.limit && raws.length > options.limit) {
      // Default direction is backward: keep the most recent `limit` messages.
      selected = options.direction === "forward" ? raws.slice(0, options.limit) : raws.slice(-options.limit);
    }
    return { messages: selected.map((r) => this.parseMessage(r)) };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const ctx = this.decodeThreadId(threadId);
    const annotation = await this.client.getCommentAnnotation(ctx);
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      metadata: {
        organizationId: ctx.organizationId,
        documentId: ctx.documentId,
        annotationId: ctx.annotationId,
        annotation: annotation ?? null,
      },
    };
  }

  /** Fetch a single comment by id within a thread, or null if not found. */
  async fetchMessage(threadId: string, messageId: string): Promise<Message<VeltRawMessage> | null> {
    const ctx = this.decodeThreadId(threadId);
    const raws = await this.client.getThreadComments(ctx);
    const match = raws.find((r) => String(r.commentId) === messageId);
    return match ? this.parseMessage(match) : null;
  }

  // --- Channels (documents) -------------------------------------------------

  /** List the threads (comment annotations) on a document. */
  async listThreads(
    channelId: string,
    options?: ListThreadsOptions,
  ): Promise<ListThreadsResult<VeltRawMessage>> {
    const ctx = this.decodeChannelId(channelId);
    const { annotations, nextPageToken } = await this.client.listAnnotations({
      ...ctx,
      pageSize: options?.limit,
      pageToken: options?.cursor,
    });
    return {
      threads: annotations.map((a) => this.annotationToSummary(a, ctx)),
      nextCursor: nextPageToken,
    };
  }

  /** Fetch the root message of every thread on a document (channel-level messages). */
  async fetchChannelMessages(
    channelId: string,
    options?: FetchOptions,
  ): Promise<FetchResult<VeltRawMessage>> {
    const ctx = this.decodeChannelId(channelId);
    const { annotations } = await this.client.listAnnotations({
      ...ctx,
      pageSize: options?.limit,
      pageToken: options?.cursor,
    });
    const messages = annotations
      .map((a) => this.annotationRootMessage(a, ctx))
      .filter((m): m is Message<VeltRawMessage> => m !== null);
    return { messages };
  }

  /** Fetch a document's metadata as Chat SDK channel info. */
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const ctx = this.decodeChannelId(channelId);
    const docs = await this.client.getDocuments({
      organizationId: ctx.organizationId,
      documentIds: [ctx.documentId],
    });
    const doc = (docs[0] ?? {}) as Record<string, unknown>;
    return {
      id: channelId,
      name: (doc.documentName as string | undefined) ?? ctx.documentId,
      metadata: { organizationId: ctx.organizationId, documentId: ctx.documentId, ...doc },
    };
  }

  /** Post a new thread (comment annotation) to a document. */
  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<VeltRawMessage>> {
    const ctx = this.decodeChannelId(channelId);
    const input = await this.toCommentInput(message);
    const { annotationId, commentIds } = await this.client.createAnnotation({
      ...ctx,
      commentData: [input],
    });
    const fullCtx = { ...ctx, annotationId: annotationId ?? "" };
    const commentId = commentIds[0] ?? input.commentId ?? 0;
    return {
      id: String(commentId),
      threadId: this.encodeThreadId(fullCtx),
      raw: this.client.toRawMessage({ ...input, commentId }, fullCtx),
    };
  }

  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  /**
   * The Chat SDK mention token for a user. Include it in a posted message (e.g.
   * `thread.post(\`thanks ${chat.mentionUser(userId)}\`)`) and the adapter turns it
   * into a real Velt mention (sets `taggedUserContacts` so the user is notified).
   */
  mentionUser(userId: string): string {
    return `{{${userId}}}`;
  }

  /** Velt has no bot typing-indicator primitive; this is a no-op. */
  async startTyping(_threadId: string, _status?: string): Promise<void> {
    return;
  }

  // --- Reactions ------------------------------------------------------------

  async addReaction(threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    await this.writeReaction("add", threadId, messageId, emoji);
  }

  async removeReaction(threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    await this.writeReaction("remove", threadId, messageId, emoji);
  }

  private async writeReaction(
    op: "add" | "remove",
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    if (this.config.backend === "managed" || !this.config.selfHostingConfig) {
      throw notSupported(
        op === "add" ? "addReaction" : "removeReaction",
        "the managed Velt backend has no reaction-write API; provide `selfHostingConfig` to enable reaction writes. Inbound reaction events still work.",
      );
    }

    const ctx = this.decodeThreadId(threadId);
    const icon = emojiName(emoji);
    const service = this.config.selfHostingConfig.reactionsService as ReactionsService;

    if (op === "add") {
      if (typeof service.saveReactions !== "function") {
        throw notSupported("addReaction", "the provided reactionsService has no `saveReactions` method.");
      }
      await service.saveReactions({
        organizationId: ctx.organizationId,
        documentId: ctx.documentId,
        reactionAnnotation: {
          [`${messageId}:${icon}`]: {
            icon,
            commentAnnotationId: ctx.annotationId,
            commentId: Number(messageId),
            fromUsers: [{ from: { userId: this.botUserId, name: this.userName } }],
          },
        },
      });
    } else {
      if (typeof service.deleteReaction !== "function") {
        throw notSupported("removeReaction", "the provided reactionsService has no `deleteReaction` method.");
      }
      await service.deleteReaction({
        organizationId: ctx.organizationId,
        documentId: ctx.documentId,
        reactionAnnotationId: `${messageId}:${icon}`,
      });
    }
  }

  // --- Users ----------------------------------------------------------------

  async getUser(userId: string): Promise<UserInfo | null> {
    if (!this.config.resolveUsers) return null;
    const [info] = await this.config.resolveUsers({ userIds: [userId] });
    if (!info) return null;
    return {
      userId,
      userName: info.userName ?? info.name ?? userId,
      fullName: info.fullName ?? info.name ?? userId,
      isBot: userId === this.botUserId,
      avatarUrl: info.avatarUrl,
      email: info.email,
    };
  }

  // --- Webhooks -------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const body = await request.text();

    try {
      verifyVeltWebhook({
        request,
        body,
        secret: this.config.webhookSecret,
        version: this.config.webhookVersion,
      });
    } catch (err) {
      this.config.logger.warn("Velt webhook signature verification failed", { error: err });
      return new Response("invalid signature", { status: 401 });
    }

    if (!this.chat) {
      this.config.logger.error("Velt webhook received before adapter was initialized");
      return new Response("adapter not initialized", { status: 500 });
    }

    let event;
    try {
      event = parseVeltWebhook(body);
    } catch (err) {
      this.config.logger.warn("Failed to parse Velt webhook payload", { error: err });
      return new Response(null, { status: 200 });
    }

    const organizationId = event.organizationId ?? this.config.organizationId;
    const { documentId, annotationId } = event;
    if (!organizationId || !documentId || !annotationId) {
      this.config.logger.debug("Velt webhook missing thread context; ignoring", {
        kind: event.kind,
      });
      return new Response(null, { status: 200 });
    }
    const threadId = this.encodeThreadId({ organizationId, documentId, annotationId });

    switch (event.kind) {
      case "comment.add":
      case "comment.update": {
        if (event.comment) {
          // Ignore the bot's own comments to avoid feedback loops.
          if (event.comment.from?.userId === this.botUserId) break;
          const raw: VeltRawMessage = {
            ...event.comment,
            organizationId,
            documentId,
            annotationId,
            documentName: event.documentName,
            documentUrl: event.documentUrl,
            anchoredText: event.anchoredText,
          };
          void this.chat.processMessage(this, threadId, this.parseMessage(raw), options);
        }
        break;
      }
      case "comment.reaction_add":
      case "comment.reaction_delete": {
        if (event.comment && event.actionUser) {
          if (event.actionUser.userId === this.botUserId) break;
          const rawEmoji = event.reaction?.iconEmoji ?? event.reaction?.icon ?? "";
          this.chat.processReaction(
            {
              added: event.kind === "comment.reaction_add",
              emoji: getEmoji(normalizeEmojiName(rawEmoji)),
              messageId: String(event.comment.commentId),
              threadId,
              rawEmoji,
              raw: event.raw,
              user: this.toAuthor(event.actionUser),
              adapter: this,
            },
            options,
          );
        }
        break;
      }
      default:
        this.config.logger.debug("Unhandled Velt webhook event", { kind: event.kind });
    }

    return new Response(null, { status: 200 });
  }

  // --- Helpers --------------------------------------------------------------

  private toAuthor(user?: VeltUser): Author {
    const userId = user?.userId ?? "unknown";
    const name = user?.name ?? userId;
    const isMe = userId === this.botUserId;
    return {
      userId,
      userName: name,
      fullName: name,
      isBot: isMe ? true : "unknown",
      isMe,
    };
  }

  private async toCommentInput(message: AdapterPostableMessage): Promise<VeltCommentInput> {
    const html = (this.converter as BaseFormatConverter).renderPostable(
      message as never,
    );
    let commentText = this.converter.extractPlainText(html);
    let commentHtml = html;
    const attachments = this.fromAttachments(
      (message as { attachments?: Attachment[] })?.attachments,
    );

    // Turn `{{userId}}` mention tokens (from `mentionUser`) into `@Name` text plus
    // the structured `to` / `taggedUserContacts` Velt needs to notify the user.
    let mention: ReturnType<typeof buildMentionFields> | undefined;
    const ids = mentionIds(`${commentText} ${commentHtml}`);
    if (ids.length) {
      const infos = this.config.resolveUsers
        ? await this.config.resolveUsers({ userIds: ids })
        : [];
      const users: VeltUser[] = ids.map((id, i) => ({
        userId: id,
        name: infos[i]?.name ?? infos[i]?.fullName ?? id,
      }));
      const nameById = new Map(users.map((u) => [u.userId, u.name]));
      const replace = (s: string): string =>
        s.replace(/\{\{([^}]+)\}\}/g, (_m, id: string) => `@${nameById.get(id) ?? id}`);
      commentText = replace(commentText);
      commentHtml = replace(commentHtml);
      mention = buildMentionFields(users);
    }

    return {
      commentText,
      commentHtml,
      from: { userId: this.botUserId, name: this.userName },
      ...(attachments.length ? { attachments } : {}),
      ...(mention
        ? { to: mention.to, taggedUserContacts: mention.taggedUserContacts, triggerNotification: true }
        : {}),
    };
  }

  /** Map a Velt annotation (with embedded comments) to a Chat SDK thread summary. */
  private annotationToSummary(
    annotation: Record<string, unknown>,
    ctx: { organizationId: string; documentId: string },
  ): ThreadSummary<VeltRawMessage> {
    const annotationId = String(annotation.annotationId ?? "");
    const comments = Array.isArray(annotation.comments) ? annotation.comments : [];
    const fullCtx = { ...ctx, annotationId };
    const root = this.client.toRawMessage(comments[0] ?? { commentId: 0 }, fullCtx);
    const last = comments[comments.length - 1] as Record<string, unknown> | undefined;
    return {
      id: this.encodeThreadId(fullCtx),
      rootMessage: this.parseMessage(root),
      replyCount: Math.max(0, comments.length - 1),
      lastReplyAt: last ? toDate(last.createdAt as number | string | undefined) : undefined,
    };
  }

  /** The root (first) comment of an annotation as a parsed message, or null if empty. */
  private annotationRootMessage(
    annotation: Record<string, unknown>,
    ctx: { organizationId: string; documentId: string },
  ): Message<VeltRawMessage> | null {
    const comments = Array.isArray(annotation.comments) ? annotation.comments : [];
    if (!comments.length) return null;
    const annotationId = String(annotation.annotationId ?? "");
    return this.parseMessage(this.client.toRawMessage(comments[0], { ...ctx, annotationId }));
  }

  /** Velt comment attachments → Chat SDK attachments (by reference). */
  private toAttachments(atts?: VeltAttachment[]): Attachment[] {
    if (!atts?.length) return [];
    return atts.map((a) => ({
      type: veltAttachmentType(a.type),
      url: a.url,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
    }));
  }

  /** Chat SDK postable attachments → Velt attachment references. */
  private fromAttachments(atts?: Attachment[]): VeltAttachment[] {
    if (!atts?.length) return [];
    return atts.map((a, i) => ({
      attachmentId: i + 1,
      name: a.name,
      url: a.url,
      mimeType: a.mimeType,
      size: a.size,
      type: a.type === "file" ? "document" : a.type,
    }));
  }
}

/** Velt stores epoch milliseconds (numbers) or ISO strings. */
function toDate(value?: number | string): Date {
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Normalize a Velt reaction icon to a Chat SDK emoji name. */
function normalizeEmojiName(raw: string): string {
  return raw && /^[A-Za-z_]+$/.test(raw) ? raw.toLowerCase() : raw;
}

function emojiName(emoji: EmojiValue | string): string {
  return typeof emoji === "string" ? emoji : emoji.name;
}

/** Unique `{{userId}}` mention-token ids found in a string. */
function mentionIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\{\{([^}]+)\}\}/g)) ids.add(m[1]!);
  return [...ids];
}

/** Map a Velt attachment kind to the Chat SDK attachment type. */
function veltAttachmentType(t?: string): Attachment["type"] {
  switch ((t ?? "").toLowerCase()) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    default:
      return "file";
  }
}
