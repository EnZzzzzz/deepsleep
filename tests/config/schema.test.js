// tests/config/schema.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { defaultConfig, normalizeConfig, normalizeProviderConfig } from "../../deepsleep/config/schema.js";

describe("defaultConfig", () => {
  it("returns valid default config", () => {
    const cfg = defaultConfig();
    assert.equal(cfg.version, "0.1.0");
    assert.equal(cfg.defaultProvider, "openai");
    assert.equal(cfg.agent.maxTurns, 50);
    assert.equal(cfg.agent.tokenBudget, 200_000);
    assert.equal(cfg.agent.timeoutMs, 600_000);
  });
});

describe("normalizeConfig", () => {
  it("fills defaults for empty input", () => {
    const cfg = normalizeConfig({});
    assert.equal(cfg.agent.maxTurns, 50);
  });
  it("merges agent config", () => {
    const cfg = normalizeConfig({ agent: { maxTurns: 10 } });
    assert.equal(cfg.agent.maxTurns, 10);
    assert.equal(cfg.agent.tokenBudget, 200_000); // preserved default
  });
});

describe("normalizeProviderConfig", () => {
  it("requires id", () => {
    assert.throws(() => normalizeProviderConfig({ type: "openai", defaultModel: "gpt-4" }), /id is required/);
  });
  it("fills default models array", () => {
    const p = normalizeProviderConfig({ id: "test", type: "openai", defaultModel: "gpt-4" });
    assert.deepEqual(p.models, ["gpt-4"]);
  });
});
