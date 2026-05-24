import { describe, it } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { AgentControl } from "../../deepsleep/agent/control.js";
import { AgentStatus, TurnAbortReason } from "../../deepsleep/protocol/types.js";
import { InputQueue } from "../../deepsleep/session/input-queue.js";

describe("AgentControl", () => {
  function dummyControl() {
    const emitter = new EventEmitter();
    const inputQueue = new InputQueue();
    const control = new AgentControl({
      agentId: "parent-1",
      statusEmitter: emitter,
      inputQueue,
      spawner: null, // no actual spawning in unit test
    });
    return { control, emitter, inputQueue };
  }

  it("subscribeStatus receives status changes", (t) => {
    const { control, emitter } = dummyControl();
    const p = new Promise((resolve) => {
      control.subscribeStatus((status) => resolve(status));
    });
    emitter.emit("status", AgentStatus.RUNNING);
    return p.then((status) => {
      assert.equal(status, AgentStatus.RUNNING);
    });
  });

  it("subscribeStatus returns unsubscribe function", () => {
    const { control, emitter } = dummyControl();
    let calls = 0;
    const unsub = control.subscribeStatus(() => calls++);
    emitter.emit("status", AgentStatus.RUNNING);
    assert.equal(calls, 1);
    unsub();
    emitter.emit("status", AgentStatus.COMPLETED);
    assert.equal(calls, 1); // not called after unsub
  });

  it("sendInterAgentMessage enqueues mailbox item", () => {
    const { control, inputQueue } = dummyControl();
    control.sendInterAgentMessage("agent-2", "hello", true);
    assert.equal(inputQueue.mailboxSize(), 1);
    const msgs = inputQueue.drainMailbox();
    assert.equal(msgs[0].from, "agent-2");
    assert.equal(msgs[0].content, "hello");
    assert.equal(msgs[0].triggerTurn, true);
  });

  it("shutdown emits error status", (t) => {
    const { control, emitter } = dummyControl();
    const p = new Promise((resolve) => {
      control.subscribeStatus((status) => resolve(status));
    });
    control.shutdown();
    return p.then((status) => {
      // shutdown broadcasts an error event => ERRORED
      assert.equal(status, AgentStatus.ERRORED);
    });
  });
});
