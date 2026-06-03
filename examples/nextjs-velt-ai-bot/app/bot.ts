import { Chat, type Thread, type Message } from "chat";
import { toAiMessages } from "chat/ai";
import { streamText } from "ai";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createVeltAdapter, type VeltAdapter, type VeltRawMessage } from "@veltdev/chat-sdk-adapter";
import { BOT_USER_ID, BOT_USER_NAME, resolveUsers } from "./database";
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
  "also given the other open comment threads on the same document and any files " +
  "the user attached; draw on them when relevant. If a teammate asks you to start " +
  "a new thread, that action is handled for you.";

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
  if (raw?.anchoredText) lines.push(`The comment is anchored to this text: "${raw.anchoredText}"`);

  // Files attached to the triggering comment (parsed by the adapter).
  if (message.attachments?.length) {
    const names = message.attachments.map((a) => a.name ?? a.url ?? "file").join(", ");
    lines.push(`The user attached: ${names}`);
  }

  // Wider document context via the adapter's channel-level calls.
  try {
    const channelId = velt.channelIdFromThreadId(thread.id);
    if (!raw?.documentName) {
      const info = await velt.fetchChannelInfo(channelId);
      if (info.name) lines.push(`Document: "${info.name}"`);
    }
    const { threads } = await velt.listThreads(channelId, { limit: 10 });
    const others = threads.filter((t) => t.id !== thread.id && t.rootMessage.text.trim());
    if (others.length) {
      const summary = others
        .slice(0, 5)
        .map((t) => `- ${t.rootMessage.text.slice(0, 80)}`)
        .join("\n");
      lines.push(`Other open comment threads on this document (${others.length}):\n${summary}`);
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
async function maybeStartThread(
  velt: VeltAdapter,
  thread: Thread,
  message: Message,
): Promise<string | null> {
  const match = message.text.match(/(?:start (?:a )?|new )thread(?:\s+about)?\s*[:-]?\s*(.+)/i);
  const topic = match?.[1]?.trim();
  if (!topic) return null;
  const channelId = velt.channelIdFromThreadId(thread.id);
  await velt.postChannelMessage(
    channelId,
    `New thread (started by Velt Bot at a teammate's request): ${topic}`,
  );
  return `Started a new comment thread on this document about "${topic}".`;
}

let chatSingleton: Chat<{ velt: VeltAdapter }> | null = null;

/**
 * Lazily construct the Chat SDK instance wired to the Velt adapter with an AI
 * streaming bot. Construction is deferred to the first request so credentials
 * only need to be present at runtime (`next build` can import this module).
 */
export function getChat(): Chat<{ velt: VeltAdapter }> {
  if (chatSingleton) return chatSingleton;

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
    state: createMemoryState(),
  });

  // Fetch the thread history, ask the LLM, and stream the reply back into the
  // Velt comment thread. Streaming uses the SDK's post-then-edit fallback since
  // the Velt adapter has no native streaming API.
  async function streamReply(thread: Thread, message: Message): Promise<void> {
    try {
      console.log(`[bot] replying in thread ${thread.id}`);
      const velt = thread.adapter as unknown as VeltAdapter;

      // Command: "start a new thread about X" -> create one via postChannelMessage.
      const started = await maybeStartThread(velt, thread, message);
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
      // Ground the reply in document + channel context (anchored text, attached
      // files, the document's other open threads, plus any resolveDocumentContext).
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
