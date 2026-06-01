import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createVeltAdapter, type VeltAdapter } from "@velt-js/chat-sdk-adapter";
import { BOT_USER_ID, BOT_USER_NAME, resolveUsers } from "./database";

let chatSingleton: Chat<{ velt: VeltAdapter }> | null = null;

/**
 * Lazily construct the Chat SDK instance wired to the Velt adapter.
 *
 * Construction is deferred to the first webhook request (rather than at module
 * load) so credentials only need to be present at runtime — `next build` can
 * import this module without `VELT_*` env vars set.
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
      }),
    },
    state: createMemoryState(),
  });

  // Reply when a user @-mentions the bot in a comment thread.
  chat.onNewMention(async (thread, message) => {
    await thread.subscribe();
    await thread.post(`Hi ${message.author.fullName}! How can I help in this thread?`);
  });

  // Continue the conversation in threads the bot is already following.
  chat.onSubscribedMessage(async (thread, message) => {
    if (message.isMention) {
      await thread.post(`You mentioned me again, ${message.author.fullName}. Still here!`);
    }
  });

  // React to reactions. NOTE: reading reactions works on all Velt plans; the
  // bot can only *write* reactions on a self-hosted Velt backend (see README),
  // so this handler only reads/logs.
  chat.onReaction(async (event) => {
    console.log(
      `${event.user.fullName} ${event.added ? "added" : "removed"} ${event.emoji} on message ${event.messageId}`,
    );
  });

  chatSingleton = chat;
  return chat;
}
