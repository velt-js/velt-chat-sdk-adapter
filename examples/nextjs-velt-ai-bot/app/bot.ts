import { Chat, type Thread, type Message } from "chat";
import { toAiMessages } from "chat/ai";
import { streamText } from "ai";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createVeltAdapter, type VeltAdapter } from "@veltdev/chat-sdk-adapter";
import { BOT_USER_ID, BOT_USER_NAME, resolveUsers } from "./database";
import { resolveModel } from "./model";

const SYSTEM_PROMPT =
  "You are a helpful assistant replying inside a Velt comment thread. " +
  "Keep replies concise, friendly, and in plain prose.";

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
      const history = await thread.adapter.fetchMessages(thread.id, { limit: 20 });
      let messages = await toAiMessages(history.messages, { includeNames: true });
      // Fall back to the triggering message so the prompt is never empty (e.g.
      // the very first reply, before any history is fetchable).
      if (messages.length === 0) {
        messages = [{ role: "user", content: message.text }];
      }
      const result = streamText({
        model: resolveModel(),
        system: SYSTEM_PROMPT,
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
