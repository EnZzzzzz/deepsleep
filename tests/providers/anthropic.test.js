import { describe, it } from "node:test";
import assert from "node:assert";
import { AnthropicProvider } from "../../deepsleep/providers/anthropic.js";

describe("AnthropicProvider", () => {
  it("constructs with defaults", () => {
    const p = new AnthropicProvider({ id: "claude", type: "anthropic", defaultModel: "claude-sonnet-4-20250514", apiKey: "sk-test" });
    assert.equal(p.baseUrl, "https://api.anthropic.com");
    assert.equal(p.defaultModel, "claude-sonnet-4-20250514");
  });

  it("_convertMessages maps roles", () => {
    const p = new AnthropicProvider({ id: "claude", type: "anthropic", defaultModel: "c", apiKey: "k" });
    const result = p._convertMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    assert.equal(result[0].role, "user");
    assert.equal(result[1].role, "assistant");
  });

  it("throws on chat without valid apiKey (network error)", async () => {
    const p = new AnthropicProvider({ id: "claude", type: "anthropic", defaultModel: "claude-sonnet-4-20250514", apiKey: "invalid-key" });
    try {
      for await (const _ of p.chat([{ role: "user", content: "hi" }])) {}
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e.message.includes("Anthropic") || e.message.includes("fetch"), `unexpected error: ${e.message}`);
    }
  });
});
