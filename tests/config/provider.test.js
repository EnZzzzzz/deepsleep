// tests/config/provider.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { Provider, ProviderRegistry } from "../../deepsleep/config/provider.js";

class MockProvider extends Provider {
  async *chat(messages, options) {
    yield { type: "text", content: "pong" };
  }
}

describe("Provider", () => {
  it("throws on unimplemented chat", async () => {
    const p = new Provider({ id: "x", type: "x", defaultModel: "m" });
    try {
      for await (const _ of p.chat([])) {}
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /must be implemented/);
    }
  });

  it("listModels returns config models", async () => {
    const p = new Provider({ id: "x", type: "x", defaultModel: "m", models: ["a", "b"] });
    assert.deepEqual(await p.listModels(), ["a", "b"]);
  });
});

describe("ProviderRegistry", () => {
  it("register and get", () => {
    const r = new ProviderRegistry();
    const p = new MockProvider({ id: "mock", type: "mock", defaultModel: "m1" });
    r.register(p);
    assert.equal(r.get("mock"), p);
  });

  it("getDefault returns correct provider", () => {
    const r = new ProviderRegistry();
    const p = new MockProvider({ id: "mock", type: "mock", defaultModel: "m1" });
    r.register(p);
    assert.equal(r.getDefault("mock"), p);
  });

  it("get returns undefined for missing", () => {
    const r = new ProviderRegistry();
    assert.equal(r.get("missing"), undefined);
  });

  it("listIds returns registered ids", () => {
    const r = new ProviderRegistry();
    r.register(new MockProvider({ id: "a", type: "mock", defaultModel: "m" }));
    r.register(new MockProvider({ id: "b", type: "mock", defaultModel: "m" }));
    assert.deepEqual(r.listIds(), ["a", "b"]);
  });
});
