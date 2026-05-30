import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Resolve the LLM used by the bot from environment variables.
 *
 * - `AI_PROVIDER` — `"anthropic"` (default) or `"openai"`.
 * - `AI_MODEL` — model id; defaults to Claude Sonnet 4.6 / GPT-4o.
 *
 * Anthropic uses `ANTHROPIC_API_KEY`; OpenAI uses `OPENAI_API_KEY`.
 */
export function resolveModel(): LanguageModel {
  const provider = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (provider === "openai") {
    return openai(process.env.AI_MODEL ?? "gpt-4o");
  }
  return anthropic(process.env.AI_MODEL ?? "claude-sonnet-4-6");
}
