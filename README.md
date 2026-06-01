# velt-chat-sdk-adapter

Chat SDK adapter for Velt. Build cross-platform AI bots that read and respond in
**[Velt](https://velt.dev) comment threads** using the
**[Chat SDK](https://chat-sdk.dev)**.

This is a monorepo:

| Package | Description |
| --- | --- |
| [`packages/chat-sdk-adapter`](./packages/chat-sdk-adapter) | The publishable `@velt-js/chat-sdk-adapter` package. |
| [`examples/nextjs-velt-bot`](./examples/nextjs-velt-bot) | A runnable Next.js example bot. |

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

## License

Apache-2.0
