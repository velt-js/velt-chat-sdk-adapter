import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@chat-adapter/shared";
import { resolveConfig } from "../config.js";
import { createVeltAdapter } from "../factory.js";
import { VeltAdapter } from "../adapter.js";
import { noopLogger } from "../logger.js";

const ENV_KEYS = [
  "VELT_API_KEY",
  "VELT_AUTH_TOKEN",
  "VELT_WEBHOOK_SECRET",
  "VELT_BOT_USER_ID",
  "VELT_BOT_USER_NAME",
  "VELT_ORGANIZATION_ID",
] as const;

const FULL = {
  apiKey: "k",
  webhookSecret: "whsec_x",
  botUserId: "velt-bot",
  botUserName: "Velt Bot",
};

describe("resolveConfig", () => {
  let saved: Record<string, string | undefined>;

  // Snapshot then clear the VELT_* env vars so tests are hermetic regardless of
  // the developer's shell, then restore exactly afterwards.
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("resolves a valid explicit config", () => {
    const cfg = resolveConfig(FULL);
    expect(cfg.apiKey).toBe("k");
    expect(cfg.webhookSecret).toBe("whsec_x");
    expect(cfg.botUserId).toBe("velt-bot");
    expect(cfg.botUserName).toBe("Velt Bot");
  });

  it("defaults webhookVersion to v2 and logger to noopLogger", () => {
    const cfg = resolveConfig(FULL);
    expect(cfg.webhookVersion).toBe("v2");
    expect(cfg.logger).toBe(noopLogger);
  });

  it("honours an explicit webhookVersion", () => {
    expect(resolveConfig({ ...FULL, webhookVersion: "v1" }).webhookVersion).toBe("v1");
  });

  it("derives the managed backend by default", () => {
    expect(resolveConfig(FULL).backend).toBe("managed");
  });

  it("derives the self-hosted backend when selfHostingConfig is set", () => {
    const cfg = resolveConfig({
      ...FULL,
      selfHostingConfig: { reactionsService: {} },
    });
    expect(cfg.backend).toBe("self-hosted");
  });

  it("falls back to environment variables", () => {
    process.env.VELT_API_KEY = "env-key";
    process.env.VELT_WEBHOOK_SECRET = "whsec_env";
    process.env.VELT_BOT_USER_ID = "env-bot";
    process.env.VELT_BOT_USER_NAME = "Env Bot";
    process.env.VELT_ORGANIZATION_ID = "env-org";
    process.env.VELT_AUTH_TOKEN = "env-token";
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe("env-key");
    expect(cfg.botUserId).toBe("env-bot");
    expect(cfg.organizationId).toBe("env-org");
    expect(cfg.authToken).toBe("env-token");
  });

  it("prefers explicit config over environment variables", () => {
    process.env.VELT_API_KEY = "env-key";
    expect(resolveConfig(FULL).apiKey).toBe("k");
  });

  it("treats empty-string env vars as missing", () => {
    process.env.VELT_API_KEY = "";
    expect(() =>
      resolveConfig({ webhookSecret: "whsec_x", botUserId: "b", botUserName: "B" }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError naming every missing required field", () => {
    let thrown: unknown;
    try {
      resolveConfig({});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    const msg = (thrown as Error).message;
    expect(msg).toContain("apiKey");
    expect(msg).toContain("webhookSecret");
    expect(msg).toContain("botUserId");
    expect(msg).toContain("botUserName");
  });

  it("does not require authToken or organizationId", () => {
    const cfg = resolveConfig(FULL);
    expect(cfg.authToken).toBeUndefined();
    expect(cfg.organizationId).toBeUndefined();
  });
});

describe("createVeltAdapter", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns a VeltAdapter for a valid config", () => {
    const adapter = createVeltAdapter(FULL);
    expect(adapter).toBeInstanceOf(VeltAdapter);
    expect(adapter.name).toBe("velt");
  });

  it("validates eagerly and throws on missing credentials", () => {
    expect(() => createVeltAdapter({ apiKey: "k" })).toThrow(ValidationError);
  });
});
