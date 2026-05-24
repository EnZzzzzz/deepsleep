import { describe, it } from "node:test";
import assert from "node:assert";
import { OpenAIProvider } from "../../deepsleep/providers/openai.js";

describe("OpenAIProvider", () => {
  it("constructs with defaults", () => {
    const p = new OpenAIProvider({ id: "gpt", type: "openai", defaultModel: "gpt-4o", apiKey: "sk-test" });
    assert.equal(p.baseUrl, "https://api.openai.com");
    assert.equal(p.defaultModel, "gpt-4o");
  });

  it("throws on chat without valid apiKey (network error)", async () => {
    const p = new OpenAIProvider({ id: "gpt", type: "openai", defaultModel: "gpt-4o", apiKey: "invalid-key" });
    try {
      for await (const _ of p.chat([{ role: "user", content: "hi" }])) {}
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e.message.includes("OpenAI") || e.message.includes("fetch"), `unexpected error: ${e.message}`);
    }
  });
});
