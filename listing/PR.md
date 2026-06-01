# Getting Velt listed on chat-sdk.dev/adapters

The directory is curated in **`vercel/chat`** (`apps/docs`). Vendor-official
adapters are added by **PR** (e.g. #321 Liveblocks, #562 AgentPhone, #517 Lark).
A Velt listing is a **3-file change**:

### 1. `apps/docs/adapters.json` — append this object to the array
```json
{
  "name": "Velt",
  "slug": "velt",
  "type": "platform",
  "community": true,
  "description": "Velt Comments adapter for building bots that read and respond in Velt comment threads on documents, text editors, and canvases.",
  "packageName": "@velt-js/chat-sdk-adapter",
  "author": "Velt",
  "readme": "https://github.com/velt-js/velt-chat-sdk-adapter/tree/289309231ac784a406073b043ea82882552faa05/packages/chat-sdk-adapter",
  "vendorOfficial": true
}
```

### 2. `apps/docs/content/adapters/vendor-official/velt.mdx`
The detail page — copy [`velt.mdx`](./velt.mdx) from this folder verbatim.

### 3. `apps/docs/content/adapters/vendor-official/meta.json` — add `"velt"`
```json
{
  "title": "Vendor-Official Adapters",
  "pages": ["matrix", "imessage", "liveblocks", "resend", "zernio", "agentphone", "lark", "velt"]
}
```

## Submit
Open a PR to `vercel/chat` with the three changes (title e.g.
*"docs(adapters): add Velt as vendor-official adapter"*), mirroring PR #321. The
Vercel team reviews and merges. Optionally also use the repo's **Adapter Request**
issue template, or post in GitHub Discussions (see `outreach.md`).

## Prerequisites before submitting
- ✅ `@velt-js/chat-sdk-adapter` published to npm (done).
- ⬜ The docs link in `velt.mdx` (`https://docs.velt.dev/integrations/chat-sdk-bot`)
  must resolve — commit + deploy that page in the Velt docs repo first.
- Re-pin the `readme` SHA in the `adapters.json` entry if `main` advances.
