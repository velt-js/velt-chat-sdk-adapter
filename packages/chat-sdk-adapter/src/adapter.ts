import {
  BaseFormatConverter,
  getEmoji,
  Message,
  type Adapter,
  type AdapterPostableMessage,
  type Author,
  type ChatInstance,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type RawMessage,
  type ThreadInfo,
  type UserInfo,
  type WebhookOptions,
} from "chat";
import { ValidationError } from "@chat-adapter/shared";
import { VeltRestClient, type VeltCommentInput } from "./client.js";
import { resolveConfig } from "./config.js";
import { ADAPTER_NAME, notSupported } from "./errors.js";
import { VeltFormatConverter } from "./format-converter.js";
import { isBotMentioned, normalizeMentionTokens } from "./mentions.js";
import { parseVeltWebhook } from "./webhook/parse.js";
import { verifyVeltWebhook } from "./webhook/verify.js";
import type {
  ResolvedVeltConfig,
  VeltAdapterConfig,
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
      attachments: [],
      isMention: isBotMentioned(raw, this.botUserId, this.userName),
      links: [],
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<VeltRawMessage>> {
    const ctx = this.decodeThreadId(threadId);
    const input = this.toCommentInput(message);
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
    const input = this.toCommentInput(message);
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

  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
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

  private toCommentInput(message: AdapterPostableMessage): VeltCommentInput {
    const html = (this.converter as BaseFormatConverter).renderPostable(
      message as never,
    );
    const text = this.converter.extractPlainText(html);
    return {
      commentText: text,
      commentHtml: html,
      from: { userId: this.botUserId, name: this.userName },
    };
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
