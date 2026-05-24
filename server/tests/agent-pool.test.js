import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { ProviderRegistry, Provider } from "../../deepsleep/config/provider.js";
import { AgentPool } from "../agent-pool.js";
import { AgentStatus } from "../../deepsleep/protocol/types.js";

describe("AgentPool", () => {
  let registry, pool;

  before(() => {
    registry = new ProviderRegistry();
    registry.register(new Provider({
      id: "test", type: "test", defaultModel: "m", models: ["m"],
    }));
  });

  beforeEach(() => { pool = new AgentPool({ registry }); });
  afterEach(async () => { await pool.shutdownAll(); });

  it("create returns a string agentId and sets PENDING_INIT", () => {
    const id = pool.create({ providerId: "test" });
    assert.ok(typeof id === "string" && id.length > 0);
    assert.equal(pool.get(id).session.getCurrentStatus(), AgentStatus.PENDING_INIT);
  });

  it("get returns entry with session, channel, loopPromise", () => {
    const id = pool.create({ providerId: "test" });
    const e = pool.get(id);
    assert.ok(e.session);
    assert.ok(typeof e.channel.send === "function");
    assert.ok(e.loopPromise instanceof Promise);
  });

  it("get returns undefined for unknown id", () => {
    assert.equal(pool.get("nope"), undefined);
  });

  it("list returns all active agents with their status", () => {
    pool.create({ providerId: "test" });
    pool.create({ providerId: "test" });
    const list = pool.list();
    assert.equal(list.length, 2);
    assert.ok(list.every(a => a.status === AgentStatus.PENDING_INIT));
  });

  it("shutdown sends SHUTDOWN op, waits for loop end, removes agent", async () => {
    const id = pool.create({ providerId: "test" });
    await pool.shutdown(id);
    assert.equal(pool.get(id), undefined);
  });

  it("shutdown is no-op for unknown id", async () => {
    await pool.shutdown("nope"); // does not throw
  });

  it("shutdownAll clears everything", async () => {
    pool.create({ providerId: "test" });
    pool.create({ providerId: "test" });
    await pool.shutdownAll();
    assert.equal(pool.list().length, 0);
  });
});
