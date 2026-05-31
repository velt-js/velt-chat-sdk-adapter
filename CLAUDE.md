# CLAUDE.md — Velt Chat SDK Adapter

## What this file is for

This is the **living logbook and map** for this project. It exists so that
anyone (human or Claude) opening this repo can, in two minutes, understand:

1. **What** we're building and **why**.
2. **How** the pieces fit together (the diagram below).
3. **The history** — every meaningful step we took, why we took it, what
   worked, and what didn't. We append to the "Decision log" as we go; we don't
   rewrite history.

Claude Code auto-loads this file as context, so keeping it accurate makes every
future session smarter. Treat it as append-only narrative + a current-state
snapshot at the top.

---

## What we're building (in plain terms)

A **bridge** that lets a "bot" live inside **Velt comment threads** using the
**Chat SDK** (chat-sdk.dev). You write bot logic once ("when mentioned, reply");
the bridge translates that into Velt's API. This mirrors what our competitor
**Liveblocks** shipped (`@liveblocks/chat-sdk-adapter`).

- The **adapter** (`@veltdev/chat-sdk-adapter`) = the plumbing. It never changes
  per-bot.
- The **bot** = a few event handlers on top. We have two flavors: a simple
  **greeting bot** and (planned) an **AI bot** that streams LLM replies.

---

## High-level diagram

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  A user, in your app's Velt comment thread, @-mentions the bot     │
  │  or adds a reaction.                                               │
  └───────────────────────────────┬───────────────────────────────────┘
                                  │  Velt fires a webhook (HTTP POST)
                                  ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │  Your app:  POST /api/webhooks/velt   (Next.js route)              │
  │             → chat.webhooks.velt(request)                          │
  └───────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │  @veltdev/chat-sdk-adapter  →  VeltAdapter.handleWebhook()         │
  │   1. verify signature (V2 HMAC / V1 token)                         │
  │   2. parse payload  →  normalized event                           │
  │   3. hand to the Chat SDK (processMessage / processReaction)      │
  └───────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │  Chat SDK fires your handler:                                      │
  │     onNewMention / onSubscribedMessage / onReaction               │
  │                                                                   │
  │     Greeting bot → thread.post("Hi …")                           │
  │     AI bot       → toAiMessages(history) → LLM stream → thread.post│
  └───────────────────────────────┬───────────────────────────────────┘
                                  │  thread.post(...)
                                  ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │  VeltAdapter.postMessage()  →  Velt REST API                      │
  │  → the reply appears in the comment thread. Loop closed.          │
  └───────────────────────────────────────────────────────────────────┘

  Velt model:  Organization ▸ Document(=channel) ▸ CommentAnnotation(=thread)
               ▸ Comments(=messages)
  Thread id:   velt:{organizationId}:{documentId}:{annotationId}
```

---

## Repo structure

```
velt-chat-sdk-adapter/                 (npm-workspaces monorepo)
├── CLAUDE.md                          ← this file
├── packages/chat-sdk-adapter/         ← @veltdev/chat-sdk-adapter (the bridge)
│   └── src/
│       ├── adapter.ts                 the VeltAdapter class (the core)
│       ├── client.ts                  talks to Velt REST API (fetch)
│       ├── format-converter.ts        Velt HTML ⇄ Chat SDK mdast
│       ├── mentions.ts                "is the bot mentioned?" logic
│       ├── webhook/{verify,parse}.ts  signature check + payload parse
│       ├── config.ts / types.ts / errors.ts / logger.ts / factory.ts
│       └── __tests__/                 39 unit tests
├── examples/
│   ├── nextjs-velt-bot/               ← greeting bot (built)
│   └── nextjs-velt-ai-bot/            ← AI streaming bot (planned)
└── (Velt docs page lives in the separate docs repo: integrations/chat-sdk-bot.mdx)
```

---

## Current status

| Piece | State |
| --- | --- |
| Adapter package | ✅ built, type-checks, 39 tests pass |
| Greeting bot example | ✅ built, `next build` green |
| AI bot example | ✅ built, type-checks, `next build` green |
| READMEs (root + package + both examples) | ✅ written |
| Velt docs page | ✅ written + wired into docs.json |
| Railway deploy config (AI bot) | ✅ Dockerfile + railway.json (image build not run locally — daemon off) |
| Live validation against real Velt | ❌ not yet — webhook/REST shapes are inferred from docs |

---

## Decision log (append-only history)

### 1. Verified the real contract before writing code
- **Did:** Read the installed `chat`, `@chat-adapter/shared`, `@veltdev/node`
  type definitions instead of trusting docs.
- **Why:** Building against guessed APIs wastes effort.
- **Worked:** Confirmed the exact `Adapter` interface, that `isMention` can be
  set deterministically (`isMention || detectMention`), and that
  `getEmoji` / `BaseFormatConverter` live in `chat` (not `@chat-adapter/shared`).

### 2. Dropped `@veltdev/node` for managed calls → used raw `fetch`
- **Did:** Call the Velt REST API directly with `fetch` in `client.ts`.
- **Why:** `@veltdev/node`'s `initialize()` *requires* a MongoDB `database`
  config (it's self-hosting-oriented), which contradicts the docs' API-only
  example.
- **Worked:** Cleaner, lighter, matches the documented REST contract exactly.
  (Note: the original plan text still says `@veltdev/node`; this log is the
  source of truth for the change.)

### 3. Reactions: honest degradation
- **Did:** `addReaction` / `removeReaction` throw on the managed backend; work
  only with a self-hosted reactions service (`selfHostingConfig`).
- **Why:** Velt has **no managed REST endpoint** to write a reaction as a user.
- **Didn't work / tradeoff:** Liveblocks' demo reacts with 👀; ours can't on
  managed. Reading reactions (`onReaction`) still works everywhere.

### 4. Both webhook systems supported
- **Did:** V2 (Svix-style HMAC, default) + V1 (`Authorization: Basic` token)
  verification in `webhook/verify.ts`.
- **Why:** V2 is Enterprise-only; V1 keeps the adapter usable on all plans.

### 5. Example bot made a lazy singleton
- **Did:** Construct the bot inside `getChat()` instead of at module import.
- **Why:** `next build` failed because the adapter validates config eagerly and
  no env vars exist at build time.
- **Worked:** Build went green; credentials are read on the first request.

### 6. AI bot variant
- **Did:** Built `examples/nextjs-velt-ai-bot`. On mention →
  `thread.adapter.fetchMessages(thread.id)` → `toAiMessages(history)` →
  `streamText({ model })` → `thread.post(result.textStream)`. Provider is
  configurable via `AI_PROVIDER`/`AI_MODEL` (`app/model.ts`), Claude Sonnet 4.6
  default; uses `ai@6` + `@ai-sdk/anthropic@3` + `@ai-sdk/openai@3`.
- **Why streaming reply (not a tool-using agent):** user choice — simplest
  mirror of Liveblocks' "Chat SDK AI Bot" example.
- **Worked:** No adapter changes needed — streaming uses the SDK's post-then-edit
  fallback (needs only `postMessage` + `editMessage`, both implemented). The
  SDK's own docstring confirmed the `fetchMessages` → `toAiMessages` pattern.
  Type-checks and `next build` green. Reused `database.ts` + the webhook route
  verbatim from the non-AI example.
- **Not yet:** live LLM responses need an `ANTHROPIC_API_KEY` + a real Velt
  webhook, so the end-to-end AI loop is unexercised (build/typecheck only).

---

### 7. Railway hosting (AI bot)
- **Did:** Added a root `Dockerfile` + `railway.json` that deploy
  `nextjs-velt-ai-bot`. Build order is explicit: `npm ci` → build the adapter →
  build the example → `next start` (binds Railway's `$PORT`).
- **Why Dockerfile over Nixpacks auto-detect:** the deployed example is a nested
  workspace that depends on another workspace package; an explicit Dockerfile
  guarantees the adapter is built first, which auto-detection can get wrong.
- **Why Railway fits:** long-lived server (not serverless), so the webhook's
  background LLM streaming completes reliably without `waitUntil` gymnastics.
- **Not verified:** the Docker image was not built locally (Docker daemon was
  off). The build commands are identical to the ones that pass locally; Railway
  builds the image server-side.

### 8. Embedded the AI bot into the tiptap sample-app demo
- **Did:** Folded the adapter + AI streaming bot directly into
  `sample-apps/.../tiptap/tiptap-comments-demo` (a separate pnpm+turbo monorepo,
  Next 16): added `lib/chat-bot/{bot,model}.ts`, `app/api/webhooks/velt/route.ts`,
  and a `VeltInitializeBotContact` component that calls
  `client.getContactElement().updateContactList([bot], { merge: true })` so the
  bot is @-mentionable. Reuses the demo's own Velt project creds.
- **Distribution:** the adapter isn't on npm, so the demo consumes it as a
  **vendored tarball** (`npm pack` → committed `vendor/*.tgz` → `file:` dep).
  Publishing to npm is the clean long-term fix (also needed for vendor-official
  tier).
- **Worked:** demo `next build` is green; type-checks pass. **Key requirement:**
  the bot must run in the *same Velt project* as the demo (`6xTc…`), not the
  separate Railway project (`AP3Gyam…`) — webhooks + replies are project-scoped.
- **Caveat:** `ai`/`@ai-sdk/anthropic` want `zod ^3.25.76`; the monorepo pins
  `3.25.67` (peer warning only; schema-less `streamText` use is unaffected).

## Known gaps / risks
- Webhook payload field names + REST request/response shapes are **inferred from
  Velt docs**, not yet validated against a live Velt instance. The first live
  @-mention is where we confirm them.
- The self-hosted reaction-write path is coded defensively but unexercised.

---

## How to update this file
When you finish a meaningful step, **append** a numbered entry to the Decision
log (Did / Why / Worked / Didn't), and refresh the Current status table. Keep the
diagram and structure in sync if they change. Don't delete past entries — the
value is the trail.
