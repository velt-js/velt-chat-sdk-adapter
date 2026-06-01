# Chat SDK adapter directory — Velt (vendor-official) entry

Proposed entry for the **Vendor Official** section of
[chat-sdk.dev/adapters](https://chat-sdk.dev/adapters). The directory pages live in
`vercel/chat` (`apps/docs`); match their exact frontmatter/schema when opening the
PR — the fields below map to what each adapter card + page shows.

## Entry fields

| Field | Value |
| --- | --- |
| Name | **Velt** |
| Slug | `velt` (page at `/adapters/vendor/velt`) |
| Tier | Vendor official |
| Status | Beta |
| Package | `@velt-js/chat-sdk-adapter` |
| Install | `npm i @velt-js/chat-sdk-adapter chat` |
| Repository | https://github.com/velt-js/velt-chat-sdk-adapter |
| Documentation | https://velt.dev/docs/ai/chat-sdk-adapter |
| Maintainer | Velt (`velt-js` org) |
| License | Apache-2.0 |

## Card description (1–2 lines)

> Build bots that read and respond in **Velt comment threads** — collaborative
> comments on documents, text editors, and canvases. Mention the bot or react and
> it replies in-thread.

## Adapter page body (draft)

**Velt** is a collaboration SDK (comments, presence, notifications, and more).
`@velt-js/chat-sdk-adapter` connects a Chat SDK bot to Velt comment threads, so the
same bot logic runs on Velt alongside Slack, Discord, and every other adapter.

**Mapping:** Organization → Document (channel) → Comment Annotation (thread) →
Comments (messages). Thread ids encode as `velt:{org}:{document}:{annotation}`.

**Supported:** `postMessage` / `editMessage` / `deleteMessage`, `fetchMessages` /
`fetchThread`, `renderFormatted` (Velt HTML ⇄ mdast), `handleWebhook`
(Advanced v2 HMAC **and** Basic v1), `onNewMention` / `onSubscribedMessage` /
`onReaction` (inbound). Reaction *writes* are self-hosted-only (managed Velt has no
reaction-write API). No streaming/scheduling/DM/modals.

**Quickstart**

```ts
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createVeltAdapter, type VeltAdapter } from "@velt-js/chat-sdk-adapter";

const chat = new Chat<{ velt: VeltAdapter }>({
  userName: "Velt Bot",
  adapters: {
    velt: createVeltAdapter({
      apiKey: process.env.VELT_API_KEY!,
      webhookSecret: process.env.VELT_WEBHOOK_SECRET!,
      botUserId: "velt-bot",
      botUserName: "Velt Bot",
    }),
  },
  state: createMemoryState(),
});

chat.onNewMention(async (thread, message) => {
  await thread.post(`Hi ${message.author.fullName}! How can I help?`);
});
```

**Examples:** `nextjs-velt-bot` (greeting) and `nextjs-velt-ai-bot` (streaming
Claude), plus a Railway `Dockerfile` — all in the repo.
