# @veltdev/chat-sdk-adapter

Build bots that read, reply, mention, and start threads in
**[Velt](https://velt.dev) comment threads** across documents, rich-text editors,
canvases, PDFs, and video, using the **[Chat SDK](https://chat-sdk.dev)**.

The Chat SDK exposes platform-agnostic events (`onNewMention`, `onReaction`,
`onSubscribedMessage`) and methods (`thread.post`, `addReaction`, …). This
adapter translates them into Velt comment-thread operations, so your bot logic
stays the same across Velt, Slack, Discord, and every other Chat SDK adapter.

## Install

```bash
npm install @veltdev/chat-sdk-adapter chat @chat-adapter/state-memory
```

`chat` is a peer dependency.

## Quickstart

```ts
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createVeltAdapter, type VeltAdapter } from "@veltdev/chat-sdk-adapter";

const chat = new Chat<{ velt: VeltAdapter }>({
  userName: "Velt Bot",
  adapters: {
    velt: createVeltAdapter({
      apiKey: process.env.VELT_API_KEY!,
      webhookSecret: process.env.VELT_WEBHOOK_SECRET!,
      botUserId: "velt-bot",
      botUserName: "Velt Bot",
      organizationId: process.env.VELT_ORGANIZATION_ID,
      resolveUsers: ({ userIds }) => userIds.map(getUser),
    }),
  },
  state: createMemoryState(),
});

chat.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`Hi ${message.author.fullName}! How can I help?`);
});
```

Expose the webhook (Next.js App Router):

```ts
// app/api/webhooks/velt/route.ts
import { after } from "next/server";
import { chat } from "@/app/bot";

export const runtime = "nodejs"; // raw body + crypto; not edge
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return chat.webhooks.velt(request, { waitUntil: (p) => after(() => p) });
}
```

## Examples & live demo

**Try it live:** open the
**[Velt tiptap comments demo](https://sample-apps-tiptap-comments-demo.vercel.app)**,
leave a comment, and @-mention **Velt Bot**, and it streams a reply back into the thread.

Runnable example apps:

- **[nextjs-velt-ai-bot](https://github.com/velt-js/velt-chat-sdk-adapter/tree/main/examples/nextjs-velt-ai-bot)**: the AI bot that streams Claude replies (the demo above runs this).
- **[nextjs-velt-bot](https://github.com/velt-js/velt-chat-sdk-adapter/tree/main/examples/nextjs-velt-bot)**: a minimal greeting bot.

## Configuration

| Option | Env fallback | Required | Description |
| --- | --- | --- | --- |
| `apiKey` | `VELT_API_KEY` | ✅ | Velt API key. |
| `webhookSecret` | `VELT_WEBHOOK_SECRET` | ✅ | Webhook signing secret (`whsec_…` for v2; Console auth token for v1). |
| `botUserId` | `VELT_BOT_USER_ID` | ✅ | The bot's Velt user id. |
| `botUserName` | `VELT_BOT_USER_NAME` | ✅ | The bot's display name (used for @-mention detection). |
| `authToken` | `VELT_AUTH_TOKEN` | - | Bot auth token. If omitted, generated from the API key for `botUserId` and refreshed automatically. |
| `organizationId` | `VELT_ORGANIZATION_ID` | - | Default org; used to scope generated tokens and as a webhook fallback. |
| `webhookVersion` | - | - | `"v2"` (default) or `"v1"`. |
| `resolveUsers` | - | - | `({ userIds }) => UserInfo[]` that resolves ids to display info. |
| `selfHostingConfig` | - | - | Enables reaction **writes** via a self-hosted backend (see below). |

## How Velt maps to the Chat SDK

| Chat SDK | Velt |
| --- | --- |
| Thread | Comment annotation (`annotationId`) inside a document |
| Message | Comment (`commentId`) |
| Channel | Document (`documentId`) |
| `thread.post` | `POST /v2/commentannotations/comments/add` |
| `editMessage` / `deleteMessage` | comments `update` / `delete` |
| `fetchMessages` / `fetchThread` | comments `get` / commentannotations `get` |
| `onNewMention` | `comment.add` webhook where the bot is tagged |
| `onReaction` | `comment.reaction_add` / `comment.reaction_delete` webhooks |

Thread ids are encoded as `velt:{organizationId}:{documentId}:{annotationId}`
(each segment URL-encoded). `encodeThreadId` / `decodeThreadId` round-trip this,
and `channelIdFromThreadId` yields `velt:{organizationId}:{documentId}`.

## What it supports

| Capability | Notes |
| --- | --- |
| Post / edit / delete messages | `postMessage` / `editMessage` / `deleteMessage` |
| Fetch a thread, its messages, or a single message | `fetchThread` / `fetchMessages` / `fetchMessage` |
| List a document's threads, fetch its messages + info | `listThreads` / `fetchChannelMessages` / `fetchChannelInfo` |
| Start a new thread on a document | `postChannelMessage` |
| Attachments | read inbound files + post by reference |
| Rich text both ways | Velt HTML ⇄ Chat SDK mdast (`renderFormatted` / `parseMessage`) |
| Mentions + document context | detect & post mentions; anchored text, document name/URL |
| Webhooks | Advanced (v2 HMAC) **and** Basic (v1 token) |
| Inbound events | new mention, follow-up, reactions |
| Reactions — reading | ✅ on all Velt plans |
| Reactions — bot **writing** | needs a self-hosted backend (Velt supports reactions via the frontend SDK). See [Reactions](#reactions) |

## Message format

Velt's authoritative comment format is **`commentHtml`**, so `VeltFormatConverter`
maps **Velt HTML ⇄ Chat SDK mdast** (it extends `BaseFormatConverter`):

- inbound: `commentHtml` → mdast (`toAst`), with `{{userId}}` mention tokens
  normalized to readable `@Name`;
- outbound: a postable (`string` / `{ markdown }` / `{ ast }` / `{ card }`) →
  Velt HTML via `renderPostable` / `fromAst`.

Each parsed `Message.raw` also carries lightweight **document context**
(`documentName`, `documentUrl`, `anchoredText`) so bots can ground replies.

## Webhooks

Configure a Velt webhook (Console → **Configurations → Webhook Service**, or
`POST /v2/workspace/webhookconfig/update`) pointing at your endpoint and enable:
`comment.add`, `comment_annotation.add`, `comment.reaction_add`,
`comment.reaction_delete` (and optionally `comment.update` / `comment.delete`).

- **Advanced (v2)** webhooks are verified with Svix-style HMAC-SHA256 using the
  `whsec_…` secret and `webhook-id` / `webhook-timestamp` / `webhook-signature`
  headers. This is the default.
- **Basic (v1)** webhooks are verified against the `Authorization: Basic <token>`
  header. Set `webhookVersion: "v1"` and pass that token as `webhookSecret`.

## Reactions

Reading reactions (`onReaction`) works on all Velt plans.

**Writing** reactions (`addReaction` / `removeReaction`) is **not supported on
the managed Velt backend**, because Velt has no managed REST endpoint to add a
reaction as a user. Calling them throws a clear `PermissionError`. To enable reaction
writes, provide a `selfHostingConfig.reactionsService` (a `@veltdev/node`
self-hosted reactions service backed by your own MongoDB); the adapter then
delegates to its `saveReactions` / `deleteReaction` methods.

## License

Apache-2.0
