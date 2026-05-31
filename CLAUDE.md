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
  **greeting bot** and an **AI bot** that streams Claude replies. The AI bot is
  **live** — deployed on Railway, replying end-to-end on the Velt tiptap demo.

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
│       └── __tests__/                 46 unit tests
├── examples/
│   ├── nextjs-velt-bot/               ← greeting bot (built)
│   └── nextjs-velt-ai-bot/            ← AI streaming bot (BUILT + LIVE on Railway)
│       └── app/{bot,model,document-context}.ts
├── Dockerfile + railway.json          ← deploys nextjs-velt-ai-bot to Railway
└── (Velt docs page → separate docs repo: integrations/chat-sdk-bot.mdx)
    (tiptap demo integration → separate sample-apps repo)
```

---

## Current status

| Piece | State |
| --- | --- |
| Adapter package (`velt-js/velt-chat-sdk-adapter@21f3283`) | ✅ built, type-checks, **46 tests** pass |
| Greeting bot example | ✅ built, `next build` green |
| AI bot example | ✅ built + **live on Railway** |
| READMEs (root + package + both examples) | ✅ written |
| Velt docs page | ✅ written + wired into docs.json (separate docs repo) |
| Railway deploy config (AI bot) | ✅ Dockerfile + railway.json |
| Tiptap demo — bot @-mentionable | ✅ shipped (`velt-js/sample-apps@900e6fc`) |
| Live validation against real Velt | ✅ **WORKING** — bot replies end-to-end on the tiptap demo |

---

## Live deployment (operational snapshot — names only, no secrets)

- **Responder:** the standalone `examples/nextjs-velt-ai-bot`, deployed on **Railway**
  at `https://sample-apps-chat-sdk-bot.up.railway.app` (deploys from `velt-js/main`
  via the root `Dockerfile`). Model: Claude Sonnet 4.6.
- **Comment source:** the **tiptap demo** (`velt-js/sample-apps`, Vercel at
  `sample-apps-tiptap-comments-demo.vercel.app`).
- **Shared Velt project:** apiKey `6xTc…`, org `sample-apps-demo-org`. The bot and
  the demo **must** be the same project (webhooks + replies are project-scoped).
- **Webhook:** Advanced (v2 / Svix) endpoint → `…/api/webhooks/velt`, comment
  events, `whsec_` signing secret.
- **Bot identity:** user `velt-bot` registered in the org (postable + mentionable).
- **Railway env vars (by name):** `VELT_API_KEY`, `VELT_AUTH_TOKEN`,
  `VELT_ORGANIZATION_ID`, `VELT_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`.

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

### 9. Live go-live + two bugs found only against real Velt
- **Setup:** the standalone Railway bot is the responder for the tiptap demo;
  both moved onto the demo's Velt project (`6xTc…`, org `sample-apps-demo-org`).
  Bot user `velt-bot` added to the org; Advanced (v2/Svix) webhook endpoint →
  the Railway URL with a `whsec_` signing secret.
- **Bug 1 (`a6f892f`):** Advanced webhook nests ids under
  `metadata.organization.organizationId` / `metadata.document.documentId`; parser
  read the flat v1 shape → `documentId` undefined → every event silently dropped
  (200, no reply). Fixed to read nested-or-flat; also handled
  `comment_annotation.add` for new-thread mentions.
- **Bug 2 (`3789e71`):** `fetchMessages` used `comments/get` with
  `userIds:[botUserId]`, and Velt **filters that endpoint by comment author** →
  empty thread before the bot posts → empty LLM prompt → `AI_InvalidPromptError`.
  Fixed to fetch the full thread via `/commentannotations/get` (embeds all
  comments, no author filter) + a fallback to the triggering message.
- **Lesson:** both bugs were invisible to unit tests (built from docs); only the
  live Svix payload + `logger: console` on the bot surfaced them. The adapter now
  has regression tests from the real payloads (42 passing).
- **Result:** ✅ bot replies end-to-end ("Hey Alex! 👋 …").

### 10. Generalized the bot + surfaced document context (`21f3283`)
- **Did:** Made the bot a general document-thread assistant (not demo-specific):
  generalized the system prompt; the adapter now extracts **document context**
  from any webhook (`documentName` / `documentUrl` / `anchoredText`) and puts it
  on each message; `parseMessage` normalizes `{{userId}}` mention tokens → `@Name`
  (the REST/history API returns the raw token, which the LLM was echoing). The bot
  prepends a lightweight context block to every prompt.
- **Why:** user asked for a bot that works on any document and can use context
  beyond the thread.
- **Worked:** 46 tests (added context-extraction + token-normalization cases).

### 11. Scope check — reverted the optional full-document fetch
- **Did:** Started a `/api/document` endpoint (tiptap demo) + a cross-repo fetch in
  the bot's `resolveDocumentContext`, then **reverted both** when the user flagged
  it as scope creep.
- **Why:** the bot is already document-aware via the lightweight context; the
  full-document fetch added cross-repo coupling for an optional "summarize the
  whole doc" feature. `resolveDocumentContext()` remains as a **documented no-op
  hook** in `examples/nextjs-velt-ai-bot/app/document-context.ts` for whoever wants
  it (wire your DB / CMS / URL / Velt CRDT).
- **Lesson:** stop and confirm before adding cross-repo surface area.

### 12. Removed the redundant tiptap-demo server-embed
- **Did:** Since the **Railway** standalone bot is the responder, deleted the
  demo's embedded bot — `lib/chat-bot`, `app/api/webhooks/velt`, the vendored
  `vendor/*.tgz`, the added deps (`chat`/`ai`/`@ai-sdk/*`/`@chat-adapter/*`/the
  adapter), and the `transpilePackages` line. **Kept** only the frontend
  `VeltInitializeBotContact` (makes `velt-bot` @-mentionable) + its mount.
- **Worked:** demo `next build` green; net change is two files. Committed +
  pushed to `velt-js/sample-apps` main (`900e6fc`).

### 13. Aligned repo with Chat SDK / Liveblocks conventions
- **Did:** Audited against chat-sdk.dev's "building an adapter" guide + Liveblocks'
  package structure. We already matched the core (src layout, ESM/ES2022, exports,
  peer `chat`, `@chat-adapter/shared`, tsup/vitest, own `@veltdev` scope, two
  examples). Closed the polish gaps: added `LICENSE` (Apache-2.0, root + package);
  `package.json` `publishConfig: { access: public }`, fixed the wrong
  `repository.url` (`veltdev` → `velt-js`), added `bugs`/`homepage`, aligned the
  `chat` peer to `^4.0.0`; README **feature-support matrix** + **message-format**
  section; `eslint.config.mjs` (+ `lint` script); `CHANGELOG.md`.
- **Non-AI bot:** already present (`examples/nextjs-velt-bot`) — mirrors
  Liveblocks' "Chat SDK Bot"; the AI one mirrors their "Chat SDK AI Bot". No new
  example needed.
- **Worked:** lint clean, build green, 46 tests pass, `npm pack` includes
  LICENSE/README/CHANGELOG/dist.
- **Vendor-official tier:** ✅ vendor-org hosting, ✅ docs, ✅ own scope; remaining
  is process — npm publish, maintenance commitment, public announcement.

## Known gaps / risks
- ✅ *Resolved:* webhook/REST shapes were inferred from docs — now **validated
  live** (two real bugs found + fixed: nested v2 metadata, author-filtered
  history), with regression tests from the real payloads.
- **Not published to npm:** `@veltdev/chat-sdk-adapter` is consumed from source /
  Railway build. Publishing is the clean path (and needed for vendor-official tier).
- **State is non-persistent:** the bot uses `createMemoryState()`; a redeploy/
  restart forgets thread subscriptions + dedup. Swap to `@chat-adapter/state-redis`
  for production.
- **Self-hosted reaction-write path** is coded defensively but still unexercised.
- **Full-document context** is a hook only (off by default) — the bot uses the
  lightweight context (title/url/anchored text) unless `resolveDocumentContext`
  is wired.

---

## How to update this file
When you finish a meaningful step, **append** a numbered entry to the Decision
log (Did / Why / Worked / Didn't), and refresh the Current status table. Keep the
diagram and structure in sync if they change. Don't delete past entries — the
value is the trail.
