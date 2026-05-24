import { describe, it } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { runTurn } from "../../deepsleep/agent/runner.js";
import { Session } from "../../deepsleep/session/session.js";
import { InputQueue } from "../../deepsleep/session/input-queue.js";
import { ProviderRegistry, Provider } from "../../deepsleep/config/provider.js";
import { AgentStatus } from "../../deepsleep/protocol/types.js";

class EchoProvider extends Provider {
  async *chat(messages, _options) {
    yield { type: "text", content: messages[messages.length - 1]?.content || "ok" };
  }
}

function sessionWithEcho() {
  const emitter = new EventEmitter();
  const registry = new ProviderRegistry();
  registry.register(new EchoProvider({ id: "echo", type: "echo", defaultModel: "echo-1" }));
  const inputQueue = new InputQueue();
  const session = new Session({ agentId: "test", agentStatus: emitter, registry, inputQueue });
  return { session, inputQueue, emitter };
}

describe("runTurn", () => {
  it("runs a simple turn and completes", async () => {
    const { session, inputQueue } = sessionWithEcho();
    inputQueue.enqueue({ role: "user", content: "hello" });
    const msg = await runTurn({ session });
    assert.equal(msg, "hello");
    assert.equal(session.getCurrentStatus(), AgentStatus.COMPLETED);
  });

  it("errors when no provider configured", async () => {
    const emitter = new EventEmitter();
    const registry = new ProviderRegistry();
    const session = new Session({ agentId: "test", agentStatus: emitter, registry, inputQueue: new InputQueue() });
    session.inputQueue.enqueue({ role: "user", content: "hi" });
    const msg = await runTurn({ session });
    assert.equal(msg, "");
    assert.equal(session.getCurrentStatus(), AgentStatus.ERRORED);
  });

  it("errors when no input", async () => {
    const { session } = sessionWithEcho();
    const msg = await runTurn({ session });
    assert.equal(msg, "");
    assert.equal(session.getCurrentStatus(), AgentStatus.ERRORED);
  });
});
