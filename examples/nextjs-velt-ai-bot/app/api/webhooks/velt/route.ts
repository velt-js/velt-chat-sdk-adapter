import { after } from "next/server";
import { getChat } from "../../../bot";

// Velt webhook signature verification needs the raw body and Node's crypto, so
// this route must run on the Node.js runtime (not the edge runtime).
export const runtime = "nodejs";
// The bot reads credentials at request time; never prerender this route.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // `chat.webhooks.velt` verifies the signature, dispatches the event, and
  // returns a fast 200. `waitUntil` keeps async processing (the LLM stream)
  // alive after the response is sent.
  return getChat().webhooks.velt(request, { waitUntil: (p) => after(() => p) });
}
