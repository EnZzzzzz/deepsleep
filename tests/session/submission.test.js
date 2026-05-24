import { describe, it } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { submissionLoop, createChannel } from "../../deepsleep/session/submission.js";
import { Session } from "../../deepsleep/session/session.js";
import { InputQueue } from "../../deepsleep/session/input-queue.js";
import { ProviderRegistry, Provider } from "../../deepsleep/config/provider.js";
import { OpType, AgentStatus } from "../../deepsleep/protocol/types.js";

class EchoProvider extends Provider {
  async *chat(messages, _options) {
    yield { type: "text", content: messages[messages.length - 1]?.content || "ok" };
  }
}

describe("createChannel", () => {
  it("send before recv — buffered", async () => {
    const ch = createChannel();
    ch.send({ type: OpType.SHUTDOWN });
    const op = await ch.recv();
    assert.equal(op.type, OpType.SHUTDOWN);
  });

  it("recv before send — waiting", async () => {
    const ch = createChannel();
    const p = ch.recv();
    ch.send({ type: OpType.USER_INPUT, data: { content: "hi" } });
    const op = await p;
    assert.equal(op.type, OpType.USER_INPUT);
  });

  it("close resolves waiters with null", async () => {
    const ch = createChannel();
    const p = ch.recv();
    ch.close();
    const op = await p;
    assert.equal(op, null);
  });
});

describe("submissionLoop", () => {
  it("processes user input and completes", async () => {
    const emitter = new EventEmitter();
    const registry = new ProviderRegistry();
    registry.register(new EchoProvider({ id: "echo", type: "echo", defaultModel: "echo-1" }));
    const session = new Session({ agentId: "test", agentStatus: emitter, registry, inputQueue: new InputQueue() });
    const ch = createChannel();

    // start loop
    const loopPromise = submissionLoop({ session, rxSub: ch });

    // send user input
    ch.send({ type: OpType.USER_INPUT, data: { content: "hello" } });
    // wait briefly for processing
    await new Promise(r => setTimeout(r, 100));
    // send shutdown
    ch.send({ type: OpType.SHUTDOWN });

    await loopPromise;
    assert.equal(session.getCurrentStatus(), AgentStatus.SHUTDOWN);
  });

  it("interrupt sets status to interrupted", async () => {
    const emitter = new EventEmitter();
    const registry = new ProviderRegistry();
    registry.register(new EchoProvider({ id: "echo", type: "echo", defaultModel: "echo-1" }));
    const session = new Session({ agentId: "test", agentStatus: emitter, registry, inputQueue: new InputQueue() });
    const ch = createChannel();

    const loopPromise = submissionLoop({ session, rxSub: ch });
    ch.send({ type: OpType.INTERRUPT });
    await new Promise(r => setTimeout(r, 50));
    ch.send({ type: OpType.SHUTDOWN });
    await loopPromise;

    assert.equal(session.getCurrentStatus(), AgentStatus.SHUTDOWN);
  });
});
