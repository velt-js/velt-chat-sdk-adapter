# Next.js Velt Chat SDK Bot

A runnable example of a [Chat SDK](https://chat-sdk.dev) bot running on
[Velt](https://velt.dev) comment threads, using
[`@velt-js/chat-sdk-adapter`](../../packages/chat-sdk-adapter).

## Setup

1. Install dependencies from the repo root:

   ```bash
   npm install
   ```

2. Configure credentials:

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in `VELT_API_KEY`, `VELT_WEBHOOK_SECRET`, and `VELT_ORGANIZATION_ID`.
   `VELT_AUTH_TOKEN` is optional — if omitted, the adapter generates a bot token
   from the API key.

3. Run the app:

   ```bash
   npm run dev
   ```

## Connect the webhook

1. Expose `http://localhost:3000/api/webhooks/velt` publicly (e.g. with a tunnel
   such as `ngrok` or `cloudflared`).
2. In the Velt Console → **Configurations → Webhook Service**, set the endpoint
   URL and enable these events:
   - `comment.add`
   - `comment_annotation.add`
   - `comment.reaction_add`
   - `comment.reaction_delete`
3. Copy the webhook secret (`whsec_…`) into `VELT_WEBHOOK_SECRET`.

Now @-mention **Velt Bot** in any comment thread on a Velt-instrumented page and
the bot replies. Add a reaction to a message and the `onReaction` handler logs
it.

## Files

| File | Purpose |
| --- | --- |
| `app/database.ts` | Mock user store + `resolveUsers`. |
| `app/bot.ts` | The `Chat` instance, the Velt adapter, and the event handlers. |
| `app/api/webhooks/velt/route.ts` | The webhook endpoint. |

## Notes

- The webhook route runs on the **Node.js runtime** (`runtime = "nodejs"`)
  because signature verification needs the raw body and Node's `crypto`.
- The bot can **read** reactions on any plan, but can only **write** reactions on
  a self-hosted Velt backend — so the example's `onReaction` handler only logs.
