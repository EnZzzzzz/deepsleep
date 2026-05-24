import { describe, it } from "node:test";
import assert from "node:assert";
import { InputQueue } from "../../deepsleep/session/input-queue.js";

describe("InputQueue", () => {
  it("starts empty", () => {
    const q = new InputQueue();
    assert.equal(q.size(), 0);
    assert.equal(q.mailboxSize(), 0);
  });

  it("enqueue and drain items", () => {
    const q = new InputQueue();
    q.enqueue({ role: "user", content: "hello" });
    q.enqueue({ role: "user", content: "world" });
    assert.equal(q.size(), 2);
    const items = q.drain();
    assert.deepEqual(items, [
      { role: "user", content: "hello" },
      { role: "user", content: "world" },
    ]);
    assert.equal(q.size(), 0); // drained
  });

  it("enqueueMailbox with trigger_turn", () => {
    const q = new InputQueue();
    q.enqueueMailbox({ from: "agent-1", content: "done", triggerTurn: true });
    assert.equal(q.mailboxSize(), 1);
    assert.equal(q.size(), 0); // mailbox is separate from main queue
    const mail = q.drainMailbox();
    assert.equal(mail.length, 1);
    assert.equal(mail[0].from, "agent-1");
  });

  it("hasTriggerTurn returns true when any mailbox item has trigger", () => {
    const q = new InputQueue();
    q.enqueueMailbox({ from: "a", content: "x", triggerTurn: false });
    assert.equal(q.hasTriggerTurn(), false);
    q.enqueueMailbox({ from: "b", content: "y", triggerTurn: true });
    assert.equal(q.hasTriggerTurn(), true);
  });

  it("drain clears all queues", () => {
    const q = new InputQueue();
    q.enqueue({ role: "user", content: "a" });
    q.enqueueMailbox({ from: "b", content: "c" });
    q.drain();
    assert.equal(q.size(), 0);
    assert.equal(q.mailboxSize(), 0);
  });
});
