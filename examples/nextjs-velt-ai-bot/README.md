# Next.js Velt Chat SDK **AI** Bot

An AI-powered [Chat SDK](https://chat-sdk.dev) bot on [Velt](https://velt.dev)
comment threads, using
[`@veltdev/chat-sdk-adapter`](../../packages/chat-sdk-adapter). When a user
@-mentions the bot, it reads the thread history, asks an LLM, and **streams** the
reply back into the thread.

This is the AI counterpart to [`nextjs-velt-bot`](../nextjs-velt-bot) (the basic
greeting bot).

**See it live:** open the
[Velt tiptap comments demo](https://sample-apps-tiptap-comments-demo.vercel.app),
leave a comment, and @-mention **Velt Bot** — this example is the responder.

## How it works

```ts
chat.onNewMention(async (thread) => {
  await thread.subscribe();
  const history = await thread.adapter.fetchMessages(thread.id, { limit: 20 });
  const messages = await toAiMessages(history.messages, { includeNames: true });
  const result = streamText({ model: resolveModel(), system: SYSTEM_PROMPT, messages });
  await thread.post(result.textStream);
});
```

`toAiMessages` (from `chat/ai`) converts the thread history into LLM messages
(the bot's own comments become `assistant`, everyone else `user`). The reply is
streamed via `thread.post(textStream)`. The Velt adapter has no native streaming
API, so the Chat SDK streams using its **post-then-edit fallback** — it posts a
placeholder, then edits it as chunks arrive.

## Setup

1. Install from the repo root: `npm install`
2. `cp .env.local.example .env.local` and fill in:
   - `VELT_API_KEY`, `VELT_WEBHOOK_SECRET`, `VELT_ORGANIZATION_ID`
   - `ANTHROPIC_API_KEY` (or set `AI_PROVIDER=openai` + `OPENAI_API_KEY`)
3. `npm run dev`

## Model configuration

| Env | Default | Notes |
| --- | --- | --- |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `AI_MODEL` | `claude-sonnet-4-6` | any model id for the provider |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | key for the chosen provider |

## Connect the webhook

Same as the basic example: expose `/api/webhooks/velt` publicly, register a Velt
webhook (Console → **Configurations → Webhook Service**) with `comment.add`,
`comment_annotation.add`, `comment.reaction_add`, `comment.reaction_delete`, and
copy the `whsec_…` secret into `VELT_WEBHOOK_SECRET`.

Then @-mention **Velt Bot** in a comment thread and watch the AI reply stream in.

## Deploy to Railway

This repo ships a root `Dockerfile` + `railway.json` that build and run **this AI
bot**. Railway runs a long-lived server (unlike serverless), so the webhook's
background LLM streaming completes reliably.

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, and select this repo.
   Railway auto-detects the root `Dockerfile` (build order: install → build the
   adapter → build this example → `next start`). Leave **Root Directory** as `/`.
3. In the service's **Variables** tab, add:
   - `VELT_API_KEY`, `VELT_WEBHOOK_SECRET`, `VELT_ORGANIZATION_ID`
     (optionally `VELT_AUTH_TOKEN`)
   - `ANTHROPIC_API_KEY` (or `AI_PROVIDER=openai` + `OPENAI_API_KEY`)
   - You do **not** set `PORT` — Railway injects it and `next start` binds to it.
4. **Settings → Networking → Generate Domain** to get a public URL.
5. Point your Velt webhook at `https://<your-domain>/api/webhooks/velt` (see the
   webhook steps above), then redeploy if you changed `VELT_WEBHOOK_SECRET`.

> To deploy the non-AI bot instead, change the two `-w nextjs-velt-ai-bot`
> references in `Dockerfile` and `railway.json` to `-w nextjs-velt-bot`.
