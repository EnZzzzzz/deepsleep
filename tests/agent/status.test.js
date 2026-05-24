// tests/agent/status.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { isFinal, agentStatusFromEvent } from "../../deepsleep/agent/status.js";
import { AgentStatus, EventType, TurnAbortReason } from "../../deepsleep/protocol/types.js";

describe("isFinal", () => {
  it("transient states are not final", () => {
    assert.equal(isFinal(AgentStatus.PENDING_INIT), false);
    assert.equal(isFinal(AgentStatus.RUNNING), false);
    assert.equal(isFinal(AgentStatus.INTERRUPTED), false);
  });
  it("terminal states are final", () => {
    assert.equal(isFinal(AgentStatus.COMPLETED), true);
    assert.equal(isFinal(AgentStatus.ERRORED), true);
    assert.equal(isFinal(AgentStatus.SHUTDOWN), true);
    assert.equal(isFinal(AgentStatus.NOT_FOUND), true);
  });
});

describe("agentStatusFromEvent", () => {
  it("TurnStarted → Running", () => {
    assert.equal(
      agentStatusFromEvent({ type: EventType.TURN_STARTED }),
      AgentStatus.RUNNING
    );
  });
  it("TurnComplete → Completed with message", () => {
    assert.equal(
      agentStatusFromEvent({ type: EventType.TURN_COMPLETE, message: "done" }),
      AgentStatus.COMPLETED
    );
  });
  it("TurnAborted with Interrupted → Interrupted", () => {
    assert.equal(
      agentStatusFromEvent({ type: EventType.TURN_ABORTED, reason: TurnAbortReason.INTERRUPTED }),
      AgentStatus.INTERRUPTED
    );
  });
  it("TurnAborted with Replaced → Errored", () => {
    assert.equal(
      agentStatusFromEvent({ type: EventType.TURN_ABORTED, reason: TurnAbortReason.REPLACED }),
      AgentStatus.ERRORED
    );
  });
  it("TurnAborted with ReviewEnded → Errored", () => {
    assert.equal(
      agentStatusFromEvent({ type: EventType.TURN_ABORTED, reason: TurnAbortReason.REVIEW_ENDED }),
      AgentStatus.ERRORED
    );
  });
  it("TurnAborted with BudgetLimited → Interrupted", () => {
    assert.equal(
      agentStatusFromEvent({ type: EventType.TURN_ABORTED, reason: TurnAbortReason.BUDGET_LIMITED }),
      AgentStatus.INTERRUPTED
    );
  });
  it("Error event → Errored", () => {
    assert.equal(
      agentStatusFromEvent({ type: EventType.ERROR, message: "boom" }),
      AgentStatus.ERRORED
    );
  });
  it("ShutdownComplete → Shutdown", () => {
    assert.equal(
      agentStatusFromEvent({ type: EventType.SHUTDOWN_COMPLETE }),
      AgentStatus.SHUTDOWN
    );
  });
  it("unknown event → null", () => {
    assert.equal(agentStatusFromEvent({ type: "unknown" }), null);
  });
});
