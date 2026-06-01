# Outreach to the Chat SDK team — request a vendor-official listing

Post to **GitHub Discussions on `vercel/chat`** (or the Vercel community Chat SDK
thread). Keep it short; lead with what it is and the links.

---

**Subject:** Vendor-official adapter for Velt comment threads

Hi Chat SDK team —

We're [Velt](https://velt.dev) (a collaboration SDK — comments, presence,
notifications). We built an official Chat SDK adapter so bots can read and respond
in **Velt comment threads**, and we'd love to be listed under **Vendor official** in
the [adapter directory](https://chat-sdk.dev/adapters).

**`@velt-js/chat-sdk-adapter`** — https://github.com/velt-js/velt-chat-sdk-adapter

- Implements the `Adapter` contract: `postMessage`/`editMessage`/`deleteMessage`,
  `fetchMessages`/`fetchThread`, `renderFormatted` (Velt HTML ⇄ mdast),
  `handleWebhook` (Velt's Advanced **v2/Svix HMAC** and Basic **v1** systems),
  plus `onNewMention` / `onSubscribedMessage` / `onReaction`.
- Published under our own scope (not the reserved `@chat-adapter/`):
  `npm i @velt-js/chat-sdk-adapter`.
- Two examples mirroring yours — a greeting bot and a streaming **Claude** AI bot —
  plus a Railway `Dockerfile`. 46 unit tests.
- **Validated live end-to-end** on our tiptap comments demo (mention → reply).

On the vendor-official requirements:
- ✅ Hosted in our GitHub org (`velt-js`)
- ✅ Documented in our primary docs: https://velt.dev/docs/ai/chat-sdk-adapter
- ✅ We commit to maintaining it
- ✅ Announcement on our changelog + social (coming with the listing)

**Ask:** what's the preferred way to add the directory entry — should we open a PR
to `vercel/chat` (`apps/docs`) following your adapter-page schema, or do you add it
from your side? Happy to provide any metadata you need. (Card draft + page content
ready to go.)

Thanks!
— The Velt team
