import { describe, it } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { Session } from "../../deepsleep/session/session.js";
import { AgentStatus, EventType, TurnAbortReason } from "../../deepsleep/protocol/types.js";
import { InputQueue } from "../../deepsleep/session/input-queue.js";
import { ProviderRegistry } from "../../deepsleep/config/provider.js";

describe("Session", () => {
  function dummySession() {
    return new Session({
      agentId: "agent-1",
      agentStatus: new EventEmitter(),
      registry: new ProviderRegistry(),
      inputQueue: new InputQueue(),
    });
  }

  it("starts in PENDING_INIT", () => {
    const s = dummySession();
    assert.equal(s.agentId, "agent-1");
  });

  it("handles event and broadcasts status change", (t) => {
    const s = dummySession();
    const p = new Promise((resolve) => {
      s.onStatusChange((status) => {
        resolve(status);
      });
    });
    s.handleEvent({ type: EventType.TURN_STARTED });
    return p.then((status) => {
      assert.equal(status, AgentStatus.RUNNING);
    });
  });

  it("handleEvent returns new status", () => {
    const s = dummySession();
    const status = s.handleEvent({ type: EventType.SHUTDOWN_COMPLETE });
    assert.equal(status, AgentStatus.SHUTDOWN);
  });

  it("isRunning returns true only when Running or Interrupted", () => {
    const s = dummySession();
    assert.equal(s.isRunning(), false);
    s.handleEvent({ type: EventType.TURN_STARTED });
    assert.equal(s.isRunning(), true);
  });

  it("getCurrentStatus returns latest status", () => {
    const s = dummySession();
    assert.equal(s.getCurrentStatus(), AgentStatus.PENDING_INIT);
    s.handleEvent({ type: EventType.TURN_COMPLETE, message: "ok" });
    assert.equal(s.getCurrentStatus(), AgentStatus.COMPLETED);
  });
});
