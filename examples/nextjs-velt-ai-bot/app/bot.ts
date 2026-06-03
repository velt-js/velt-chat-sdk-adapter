import { Chat, type Thread, type Message, type StateAdapter } from "chat";
import { toAiMessages, type AiMessage, type AiMessagePart } from "chat/ai";
import { streamText } from "ai";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { createVeltAdapter, type VeltAdapter, type VeltRawMessage } from "@veltdev/chat-sdk-adapter";
import { BOT_USER_ID, BOT_USER_NAME, rememberUser, resolveUsers } from "./database";
import { resolveModel } from "./model";
import { resolveDocumentContext } from "./document-context";

const SYSTEM_PROMPT =
  "You are a helpful AI assistant that participates in comment threads on " +
  "documents inside any app. You can answer questions, help with writing " +
  "(drafting, editing, summarizing), brainstorm, explain concepts, and help with " +
  "code. Be concise and friendly, in plain prose suited to a comment thread. " +
  "You are given the comment thread and, when available, context about the " +
  "document (its title/URL and the specific text a comment is anchored to). Use " +
  "that context to give relevant, grounded answers. If you're asked about the " +
  "document and don't have enough context, briefly say what you'd need. You are " +
  "given the FULL contents of the other open comment threads on this document, so " +
  "use them when asked. Images shared in this thread are provided to you directly, " +
  "so read and describe what you actually see; for non-image files you are given " +
  "only the filename, so never guess their contents. Never claim you have started, " +
  "created, or posted a new thread yourself — that is handled outside of your reply.";

/**
 * Assemble the per-message context: document info, attached files, and the other
 * open comment threads on the same document. The thread list and document name
 * come from the adapter's channel-level calls (`listThreads` / `fetchChannelInfo`),
 * so every reply is aware of the wider conversation, not just this thread.
 */
async function buildContextBlock(
  velt: VeltAdapter,
  thread: Thread,
  message: Message,
): Promise<string> {
  const raw = message.raw as VeltRawMessage | undefined;
  const lines: string[] = [];

  if (raw?.documentName) lines.push(`Document: "${raw.documentName}"`);
  if (raw?.documentUrl) lines.push(`URL: ${raw.documentUrl}`);
  if (raw?.anchoredText) lines.push(`The comment here is anchored to this text: "${raw.anchoredText}"`);

  // Wider document context via the adapter's channel-level calls. We include the
  // FULL conversation of each other thread (not just its first comment), plus the
  // names of any files attached anywhere in it.
  try {
    const channelId = velt.channelIdFromThreadId(thread.id);
    if (!raw?.documentName) {
      const info = await velt.fetchChannelInfo(channelId);
      if (info.name) lines.push(`Document: "${info.name}"`);
    }
    const { threads } = await velt.listThreads(channelId, { limit: 10 });
    const others = threads.filter((t) => t.id !== thread.id);
    if (others.length) {
      const blocks = await Promise.all(
        others.slice(0, 5).map(async (t, i) => {
          let convo = t.rootMessage.text;
          const atts: string[] = [];
          try {
            const { messages: msgs } = await velt.fetchMessages(t.id, { limit: 20 });
            convo = msgs
              .map((m) => `  ${m.author.fullName ?? "User"}: ${m.text}`.trimEnd())
              .filter((s) => s.trim())
              .join("\n");
            for (const m of msgs) for (const a of m.attachments ?? []) atts.push(a.name ?? a.url ?? "file");
          } catch {
            // fall back to the root message text if the full fetch fails
          }
          const attLine = atts.length ? `\n  [attachments: ${atts.join(", ")}]` : "";
          return `Thread ${i + 1}:\n${convo}${attLine}`;
        }),
      );
      lines.push(`Other open comment threads on this document:\n\n${blocks.join("\n\n")}`);
    }
  } catch (err) {
    console.warn("[bot] channel context unavailable:", err);
  }

  if (raw) {
    const fullContent = await resolveDocumentContext(raw).catch(() => null);
    if (fullContent) lines.push(`\nDocument content:\n${fullContent}`);
  }

  return lines.length ? `--- Context ---\n${lines.join("\n")}` : "";
}

/**
 * If the user asked the bot to start a new thread (e.g. "@Velt Bot start a thread
 * about edge cases"), create one on the document via `postChannelMessage` and
 * return a confirmation. Returns null if the message isn't such a request.
 */
const WANTS_THREAD = /\b(?:start|create|open|make)\s+(?:a\s+)?(?:new\s+)?thread\b|\bnew thread\b/i;

// "Awaiting a topic" lives in the Chat SDK state store (Redis in production), so
// the two-step flow survives restarts and works across multiple bot instances.
const PENDING_TOPIC_TTL_MS = 10 * 60 * 1000;
const pendingTopicKey = (threadId: string): string => `pending-thread-topic:${threadId}`;

/**
 * Extract a thread topic: prefer quoted text, then an about/on/for/:/- connector,
 * then (only for a direct answer) the whole message minus a leading @mention.
 */
function extractTopic(text: string, allowWhole: boolean): string | null {
  const quoted = text.match(/["“”']([^"“”']{2,})["“”']/);
  if (quoted) return quoted[1]!.trim();
  const connector =
    text.match(/\b(?:about|on|regarding|for)\b\s+(.+)/i) ?? text.match(/\bthread\b\s*[:-]\s*(.+)/i);
  if (connector) return connector[1]!.replace(/[?!.\s]+$/, "").trim() || null;
  if (allowWhole) {
    const whole = text
      .replace(/^\s*@[\w.-]+(?:\s+[A-Z][\w.'-]*)?\s*/, "") // drop a leading @Mention
      .replace(/[?!.\s]+$/, "")
      .trim();
    return whole.length >= 2 ? whole : null;
  }
  return null;
}

async function createThread(
  velt: VeltAdapter,
  thread: Thread,
  message: Message,
  topic: string,
): Promise<string> {
  const channelId = velt.channelIdFromThreadId(thread.id);
  // Tag the requester in the new thread so they're notified and credited.
  const requester = message.author?.userId ? velt.mentionUser(message.author.userId) : "a teammate";
  await velt.postChannelMessage(
    channelId,
    `${topic}\n\n(New thread started by Velt Bot for ${requester}.)`,
  );
  return `Done! I created a new thread starting with "${topic}" and tagged you in it.`;
}

/**
 * Deterministically handle "start a new thread" requests so the LLM never does
 * (and can't falsely claim it created one). Two-step: if asked with no topic, the
 * bot asks for one and then creates the thread from the next message in this thread.
 */
async function maybeStartThread(
  state: StateAdapter,
  velt: VeltAdapter,
  thread: Thread,
  message: Message,
): Promise<string | null> {
  const text = message.text ?? "";
  const wantsThread = WANTS_THREAD.test(text);
  const key = pendingTopicKey(thread.id);

  // Step 2: we previously asked this thread for a topic — treat this as the answer.
  if (!wantsThread && (await state.get<boolean>(key))) {
    await state.delete(key);
    const topic = extractTopic(text, true);
    return topic ? createThread(velt, thread, message, topic) : null;
  }

  if (!wantsThread) return null;

  // Step 1: explicit request. Use an inline topic if given, else ask for one.
  const topic = extractTopic(text, false);
  if (!topic) {
    await state.set(key, true, PENDING_TOPIC_TTL_MS);
    return 'Sure, what should the new thread be about? Tell me a topic (e.g. "start a thread about edge cases") and I\'ll create it.';
  }
  await state.delete(key);
  return createThread(velt, thread, message, topic);
}

/** Image attachments (with a URL) across the messages, deduped and capped. */
function collectImages(messages: Message[]): { url: string; mediaType?: string }[] {
  const seen = new Set<string>();
  const out: { url: string; mediaType?: string }[] = [];
  for (const m of messages) {
    for (const a of m.attachments ?? []) {
      if (a.type === "image" && a.url && !seen.has(a.url)) {
        seen.add(a.url);
        out.push({ url: a.url, mediaType: a.mimeType });
      }
    }
  }
  return out.slice(0, 6);
}

/** Names of non-image attachments across the messages. */
function collectFileNames(messages: Message[]): string[] {
  const names: string[] = [];
  for (const m of messages) {
    for (const a of m.attachments ?? []) {
      if (a.type !== "image") names.push(a.name ?? a.url ?? "file");
    }
  }
  return names;
}

/**
 * Attach the thread's images (so the multimodal model can actually read them) and
 * a note about non-image files to the most recent user turn. Editing the existing
 * user turn (rather than adding one) keeps the user/assistant alternation intact.
 */
function withThreadAttachments(
  messages: AiMessage[],
  images: { url: string; mediaType?: string }[],
  fileNames: string[],
): AiMessage[] {
  if (!images.length && !fileNames.length) return messages;
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      idx = i;
      break;
    }
  }
  if (idx < 0) return messages;

  const prev = messages[idx]!;
  const baseText =
    typeof prev.content === "string"
      ? prev.content
      : prev.content
          .filter((p): p is Extract<AiMessagePart, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n");

  const parts: AiMessagePart[] = [];
  if (baseText) parts.push({ type: "text", text: baseText });
  for (const img of images) parts.push({ type: "image", image: img.url, mediaType: img.mediaType });
  if (fileNames.length) {
    parts.push({
      type: "text",
      text: `(Non-image files attached in this thread: ${fileNames.join(", ")}. You can see their names but not their contents.)`,
    });
  }

  const next = [...messages];
  next[idx] = { role: "user", content: parts };
  return next;
}

let chatSingleton: Chat<{ velt: VeltAdapter }> | null = null;

/**
 * Lazily construct the Chat SDK instance wired to the Velt adapter with an AI
 * streaming bot. Construction is deferred to the first request so credentials
 * only need to be present at runtime (`next build` can import this module).
 */
export function getChat(): Chat<{ velt: VeltAdapter }> {
  if (chatSingleton) return chatSingleton;

  // Persistent state when REDIS_URL is set (createRedisState auto-detects it), so
  // subscriptions, dedup, and the bot's "awaiting a thread topic" flag survive
  // restarts; falls back to in-memory state for local/zero-config runs.
  const state: StateAdapter = process.env.REDIS_URL ? createRedisState() : createMemoryState();

  const chat = new Chat<{ velt: VeltAdapter }>({
    userName: BOT_USER_NAME,
    adapters: {
      velt: createVeltAdapter({
        botUserId: BOT_USER_ID,
        botUserName: BOT_USER_NAME,
        organizationId: process.env.VELT_ORGANIZATION_ID,
        resolveUsers,
        // Surface adapter diagnostics (signature/parse/dispatch) in server logs.
        logger: console,
      }),
    },
    state,
  });

  // Fetch the thread history, ask the LLM, and stream the reply back into the
  // Velt comment thread. Streaming uses the SDK's post-then-edit fallback since
  // the Velt adapter has no native streaming API.
  async function streamReply(thread: Thread, message: Message): Promise<void> {
    try {
      console.log(`[bot] replying in thread ${thread.id}`);
      const velt = thread.adapter as unknown as VeltAdapter;
      // Remember who's talking so mentions of them resolve to their display name.
      rememberUser(message.author?.userId, message.author?.fullName);

      // Command: "start a new thread about X" -> create one via postChannelMessage.
      const started = await maybeStartThread(state, velt, thread, message);
      if (started) {
        await thread.post(started);
        console.log(`[bot] started a new thread from ${thread.id}`);
        return;
      }

      const history = await thread.adapter.fetchMessages(thread.id, { limit: 20 });
      let messages = await toAiMessages(history.messages, { includeNames: true });
      // Fall back to the triggering message so the prompt is never empty (e.g.
      // the very first reply, before any history is fetchable).
      if (messages.length === 0) {
        messages = [{ role: "user", content: message.text }];
      }
      // Give the multimodal model the actual images shared in this thread (from
      // the history, which includes the triggering comment), plus the names of any
      // non-image files, so it can answer about attachments instead of guessing.
      messages = withThreadAttachments(
        messages,
        collectImages(history.messages),
        collectFileNames(history.messages),
      );
      // Ground the reply in document + channel context (anchored text, the full
      // contents of the document's other open threads, plus any resolveDocumentContext).
      const contextBlock = await buildContextBlock(velt, thread, message);
      const system = contextBlock ? `${SYSTEM_PROMPT}\n\n${contextBlock}` : SYSTEM_PROMPT;

      const result = streamText({
        model: resolveModel(),
        system,
        messages,
      });
      await thread.post(result.textStream);
      console.log(`[bot] reply posted in thread ${thread.id}`);
    } catch (err) {
      console.error("[bot] streamReply failed:", err);
    }
  }

  // Respond when a user @-mentions the bot in a new thread.
  chat.onNewMention(async (thread, message) => {
    console.log(`[bot] onNewMention thread=${thread.id}`);
    await thread.subscribe();
    await streamReply(thread, message);
  });

  // Keep responding when mentioned again in threads the bot already follows.
  chat.onSubscribedMessage(async (thread, message) => {
    console.log(`[bot] onSubscribedMessage thread=${thread.id} isMention=${message.isMention}`);
    if (message.isMention) {
      await streamReply(thread, message);
    }
  });

  chatSingleton = chat;
  return chat;
}
