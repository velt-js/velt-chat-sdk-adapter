import { ValidationError } from "@chat-adapter/shared";
import { ADAPTER_NAME, mapVeltError } from "./errors.js";
import type {
  ResolvedVeltConfig,
  VeltRawMessage,
  VeltTaggedContact,
  VeltUser,
} from "./types.js";

const VELT_API_BASE = "https://api.velt.dev";
/** Velt auth tokens last 48h; refresh well before that. */
const TOKEN_TTL_MS = 40 * 60 * 60 * 1000;

/** A comment as accepted by the Velt REST API write endpoints. */
export interface VeltCommentInput {
  commentId?: number;
  commentText?: string;
  commentHtml?: string;
  from: { userId: string; name?: string; email?: string };
  taggedUserContacts?: VeltTaggedContact[];
  createdAt?: number;
  lastUpdated?: number;
}

interface VeltResultEnvelope<T = unknown> {
  result?: { status?: string; message?: string; data?: T };
}

/**
 * Thin REST client for the managed Velt backend (`https://api.velt.dev/v2/*`).
 *
 * Uses `fetch` directly rather than `@veltdev/node` because that SDK's
 * `initialize()` requires a MongoDB `database` config (it is oriented at the
 * self-hosting backend), whereas the managed comment endpoints only need the
 * `x-velt-api-key` + `x-velt-auth-token` headers.
 *
 * Centralizes the bot auth-token lifecycle: tokens are generated per
 * organization via the auth API and refreshed on expiry or on a 401.
 */
export class VeltRestClient {
  private readonly config: ResolvedVeltConfig;
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(config: ResolvedVeltConfig) {
    this.config = config;
  }

  /** Resolve an auth token for the given organization, generating if needed. */
  private async ensureAuthToken(organizationId?: string): Promise<string> {
    if (this.config.authToken) return this.config.authToken;

    const orgId = organizationId ?? this.config.organizationId;
    if (!orgId) {
      throw new ValidationError(
        ADAPTER_NAME,
        "No authToken provided and no organizationId available to generate one. " +
          "Set `authToken` (or VELT_AUTH_TOKEN), or pass `organizationId`.",
      );
    }

    const cached = this.tokenCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const token = await this.generateToken(orgId);
    this.tokenCache.set(orgId, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  /** Generate a bot auth token scoped to an organization (editor access). */
  private async generateToken(organizationId: string): Promise<string> {
    const data = await this.rawRequest<{ token?: string }>(
      "/v2/auth/generate_token",
      {
        userId: this.config.botUserId,
        userProperties: { name: this.config.botUserName },
        permissions: {
          resources: [
            { type: "organization", id: organizationId, accessRole: "editor" },
          ],
        },
      },
      undefined,
      { action: "generate auth token" },
    );
    const token = data?.token;
    if (!token) {
      throw mapVeltError(new Error("Velt auth API returned no token"), {
        action: "generate auth token",
      });
    }
    return token;
  }

  /** Low-level request that does not auto-attach an auth token. */
  private async rawRequest<T>(
    path: string,
    payload: unknown,
    authToken: string | undefined,
    ctx: { action: string; resourceType?: string; resourceId?: string },
  ): Promise<T | undefined> {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-velt-api-key": this.config.apiKey,
      };
      if (authToken) headers["x-velt-auth-token"] = authToken;
      response = await fetch(`${VELT_API_BASE}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: payload }),
      });
    } catch (err) {
      throw mapVeltError(err, ctx);
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      const error = Object.assign(
        new Error(`Velt API ${response.status}: ${detail || response.statusText}`),
        { status: response.status },
      );
      throw mapVeltError(error, ctx);
    }

    const json = (await response.json()) as VeltResultEnvelope<T>;
    if (json?.result?.status && json.result.status !== "success") {
      throw mapVeltError(
        Object.assign(new Error(json.result.message ?? "Velt API error"), {
          status: 400,
        }),
        ctx,
      );
    }
    return json?.result?.data;
  }

  /** Authenticated request with auth-token refresh + single 401 retry. */
  private async request<T>(
    path: string,
    payload: { organizationId: string } & Record<string, unknown>,
    ctx: { action: string; resourceType?: string; resourceId?: string },
  ): Promise<T | undefined> {
    const token = await this.ensureAuthToken(payload.organizationId);
    try {
      return await this.rawRequest<T>(path, payload, token, ctx);
    } catch (err) {
      const status = (err as { code?: string })?.code;
      const isAuth = status === "401" || (err as { name?: string })?.name === "AuthenticationError";
      if (isAuth && !this.config.authToken) {
        this.tokenCache.delete(payload.organizationId);
        const fresh = await this.ensureAuthToken(payload.organizationId);
        return await this.rawRequest<T>(path, payload, fresh, ctx);
      }
      throw err;
    }
  }

  /** Add reply comments to an existing annotation (thread). */
  async addComments(args: {
    organizationId: string;
    documentId: string;
    annotationId: string;
    commentData: VeltCommentInput[];
  }): Promise<number[]> {
    const data = await this.request<number[]>(
      "/v2/commentannotations/comments/add",
      args,
      { action: "post comment" },
    );
    return Array.isArray(data) ? data : [];
  }

  /** Update an existing comment. */
  async updateComments(args: {
    organizationId: string;
    documentId: string;
    annotationId: string;
    commentIds: number[];
    updatedData: Partial<VeltCommentInput>;
  }): Promise<void> {
    await this.request("/v2/commentannotations/comments/update", args, {
      action: "edit comment",
    });
  }

  /** Delete comments from an annotation. */
  async deleteComments(args: {
    organizationId: string;
    documentId: string;
    annotationId: string;
    commentIds: number[];
  }): Promise<void> {
    await this.request("/v2/commentannotations/comments/delete", args, {
      action: "delete comment",
    });
  }

  /** Fetch comments within an annotation. */
  async getComments(args: {
    organizationId: string;
    documentId: string;
    annotationId: string;
    userIds: string[];
  }): Promise<VeltRawMessage[]> {
    const data = await this.request<unknown[]>(
      "/v2/commentannotations/comments/get",
      args,
      { action: "fetch comments", resourceType: "thread", resourceId: args.annotationId },
    );
    const comments = Array.isArray(data) ? data : [];
    return comments.map((c) => this.toRawMessage(c, args));
  }

  /** Fetch a single comment annotation (thread). */
  async getCommentAnnotation(args: {
    organizationId: string;
    documentId: string;
    annotationId: string;
  }): Promise<Record<string, unknown> | undefined> {
    const data = await this.request<unknown[]>(
      "/v2/commentannotations/get",
      { ...args, annotationIds: [args.annotationId] },
      { action: "fetch thread", resourceType: "thread", resourceId: args.annotationId },
    );
    const list = Array.isArray(data) ? data : [];
    return (list[0] as Record<string, unknown>) ?? undefined;
  }

  /**
   * Fetch ALL comments in a thread via the annotation endpoint.
   *
   * Uses `/v2/commentannotations/get` (which embeds `comments[]`) rather than
   * `/comments/get`, because the latter's `userIds` parameter filters by comment
   * author — passing only the bot's id returns an empty thread until the bot has
   * posted. The annotation endpoint applies no author filter.
   */
  async getThreadComments(args: {
    organizationId: string;
    documentId: string;
    annotationId: string;
  }): Promise<VeltRawMessage[]> {
    const annotation = await this.getCommentAnnotation(args);
    const comments = annotation && Array.isArray(annotation.comments) ? annotation.comments : [];
    return comments.map((c) => this.toRawMessage(c, args));
  }

  /** Normalize a raw Velt comment into a {@link VeltRawMessage}. */
  toRawMessage(
    comment: unknown,
    ctx: { organizationId: string; documentId: string; annotationId: string },
  ): VeltRawMessage {
    const c = (comment ?? {}) as Record<string, unknown>;
    return {
      commentId: Number(c.commentId),
      commentText: c.commentText as string | undefined,
      commentHtml: c.commentHtml as string | undefined,
      from: c.from as VeltUser | undefined,
      to: c.to as VeltUser[] | undefined,
      taggedUserContacts: c.taggedUserContacts as VeltTaggedContact[] | undefined,
      createdAt: c.createdAt as number | string | undefined,
      lastUpdated: c.lastUpdated as number | string | undefined,
      editedAt: c.editedAt as number | string | undefined,
      isEdited: c.isEdited as boolean | undefined,
      reactionAnnotations: c.reactionAnnotations as VeltRawMessage["reactionAnnotations"],
      organizationId: ctx.organizationId,
      documentId: ctx.documentId,
      annotationId: ctx.annotationId,
    };
  }
}
