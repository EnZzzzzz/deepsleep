import { describe, it } from "node:test";
import assert from "node:assert";
import { AgentStatus, TurnAbortReason, EventType, OpType } from "../../deepsleep/protocol/types.js";

describe("AgentStatus", () => {
  it("should have 7 statuses", () => {
    assert.equal(Object.keys(AgentStatus).length, 7);
  });
  it("should be frozen", () => {
    assert.throws(() => { AgentStatus.NEW = "new"; }, TypeError);
  });
});

describe("TurnAbortReason", () => {
  it("should have 4 reasons", () => {
    assert.equal(Object.keys(TurnAbortReason).length, 4);
  });
});

describe("EventType", () => {
  it("should have 5 event types", () => {
    assert.equal(Object.keys(EventType).length, 5);
  });
});

describe("OpType", () => {
  it("should have 6 op types", () => {
    assert.equal(Object.keys(OpType).length, 6);
  });
});
