# velt-chat-sdk-adapter

Chat SDK adapter for Velt: build bots that read and reply in
**[Velt](https://velt.dev) comment threads** across documents, rich-text editors,
canvases, PDFs, and video, using the **[Chat SDK](https://chat-sdk.dev)**.

The bot can post, edit, and delete messages; fetch a thread, its history, or a
single message; list a document's threads and post new ones; read attachments and
mentions; and act on inbound mentions and reactions. See the
[package README](./packages/chat-sdk-adapter/README.md#what-it-supports) for the
full capability list.

This is a monorepo:

| Package | Description |
| --- | --- |
| [`packages/chat-sdk-adapter`](./packages/chat-sdk-adapter) | The publishable `@veltdev/chat-sdk-adapter` package. |
| [`examples/nextjs-velt-bot`](./examples/nextjs-velt-bot) | A runnable Next.js greeting bot. |
| [`examples/nextjs-velt-ai-bot`](./examples/nextjs-velt-ai-bot) | A runnable Next.js AI bot that streams Claude replies. |

## Quick start

```bash
npm install
npm run build      # build the adapter
npm test           # run the adapter's unit tests
```

See the [package README](./packages/chat-sdk-adapter/README.md) for full usage,
configuration, and the Velt ↔ Chat SDK mapping.

## Example app

```bash
cd examples/nextjs-velt-bot
cp .env.local.example .env.local   # fill in your Velt credentials
npm run dev
```

Then configure a Velt webhook pointing at `/api/webhooks/velt` and @-mention the
bot in any comment thread. See the
[example README](./examples/nextjs-velt-bot/README.md).

## Live demo

Try the AI bot live: open the
**[Velt tiptap comments demo](https://sample-apps-tiptap-comments-demo.vercel.app)**,
leave a comment, and @-mention **Velt Bot**, and it streams a reply back into the thread.
The responder is the [`nextjs-velt-ai-bot`](./examples/nextjs-velt-ai-bot) example.

## License

Apache-2.0
