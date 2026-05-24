import { describe, it } from "node:test";
import assert from "node:assert";
import {
  AgentStatus, TurnAbortReason, EventType, OpType,
  isFinal, agentStatusFromEvent,
  ConfigManager, Provider, ProviderRegistry,
  Session, InputQueue, submissionLoop, createChannel,
  runTurn,
} from "../deepsleep/index.js";

describe("deepsleep integration", () => {
  it("all public API exports are importable", () => {
    assert.ok(AgentStatus);
    assert.ok(isFinal);
    assert.ok(ConfigManager);
    assert.ok(Provider);
    assert.ok(ProviderRegistry);
    assert.ok(Session);
    assert.ok(InputQueue);
    assert.ok(submissionLoop);
    assert.ok(createChannel);
    assert.ok(runTurn);
  });

  it("end-to-end: user input -> run -> complete", async () => {
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    const registry = new ProviderRegistry();

    // Register an echo provider
    class EchoProvider extends Provider {
      async *chat(messages) {
        const last = messages[messages.length - 1]?.content || "ok";
        yield { type: "text", content: last };
      }
    }
    registry.register(new EchoProvider({ id: "echo", type: "echo", defaultModel: "echo-1" }));

    const session = new Session({ agentId: "test", agentStatus: emitter, registry, inputQueue: new InputQueue() });
    const ch = createChannel();

    const loopPromise = submissionLoop({ session, rxSub: ch });

    // Track state changes
    const states = [];
    session.onStatusChange(s => states.push(s));

    ch.send({ type: OpType.USER_INPUT, data: { content: "hello world" } });
    await new Promise(r => setTimeout(r, 100));
    ch.send({ type: OpType.SHUTDOWN });
    await loopPromise;

    assert.ok(states.includes(AgentStatus.RUNNING));
    assert.ok(states.includes(AgentStatus.COMPLETED));
    assert.equal(session.getCurrentStatus(), AgentStatus.SHUTDOWN);
  });
});
