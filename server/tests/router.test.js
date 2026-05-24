import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { Router } from "../router.js";
import { AgentStatus, EventType, OpType } from "../../deepsleep/protocol/types.js";

describe("Router", () => {
  let pool, session, channel, sent, router;

  function send(msg) { sent.push(msg); }

  beforeEach(() => {
    sent = [];
    const emitter = new EventEmitter();
    session = {
      getCurrentStatus: mock.fn(() => AgentStatus.PENDING_INIT),
      getHistory: mock.fn(() => [{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }]),
      onStatusChange: mock.fn((cb) => emitter.on("status", cb)),
      onEvent: mock.fn((cb) => emitter.on("event", cb)),
      _statusEmitter: emitter,
    };
    channel = { send: mock.fn() };
    pool = {
      create: mock.fn(() => "a1"),
      get: mock.fn((id) => id === "a1" ? { session, channel, loopPromise: Promise.resolve() } : undefined),
      list: mock.fn(() => [{ agentId: "a1", status: "running" }]),
      shutdown: mock.fn(() => Promise.resolve()),
    };
    router = new Router(pool);
  });

  it("agent.create responds with agent.created", async () => {
    await router.handle({ id: "1", type: "agent.create", data: {} }, send);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].id, "1");
    assert.equal(sent[0].type, "agent.created");
    assert.equal(sent[0].agentId, "a1");
  });

  it("agent.create binds status and event pushes", async () => {
    await router.handle({ id: "1", type: "agent.create", data: {} }, send);
    session._statusEmitter.emit("status", AgentStatus.RUNNING);
    const statusPush = sent.find(m => m.type === "agent.status");
    assert.ok(statusPush);
    assert.equal(statusPush.agentId, "a1");
    assert.equal(statusPush.data.status, AgentStatus.RUNNING);
    assert.equal(statusPush.id, undefined);
  });

  it("agent.list responds with agent list", async () => {
    await router.handle({ id: "2", type: "agent.list", data: {} }, send);
    assert.equal(sent[0].type, "agent.list");
    assert.equal(sent[0].data.agents.length, 1);
  });

  it("agent.history responds with messages", async () => {
    await router.handle({ id: "3", type: "agent.history", agentId: "a1", data: {} }, send);
    assert.equal(sent[0].type, "agent.history");
    assert.equal(sent[0].data.messages.length, 2);
  });

  it("agent.message sends USER_INPUT op and waits for turn end", async () => {
    await router.handle({ id: "1", type: "agent.create", data: {} }, send);
    sent.length = 0; // reset after create
    channel.send = mock.fn(() => {
      setImmediate(() => {
        session._statusEmitter.emit("event", { type: EventType.TURN_COMPLETE, message: "reply text" });
      });
    });
    await router.handle({ id: "4", type: "agent.message", agentId: "a1", data: { content: "hi" } }, send);
    assert.equal(channel.send.mock.callCount(), 1);
    assert.equal(channel.send.mock.calls[0].arguments[0].type, OpType.USER_INPUT);
    const response = sent.find(m => m.id === "4");
    assert.equal(response.type, "agent.message");
    assert.equal(response.data.message, "reply text");
  });

  it("agent.interrupt sends INTERRUPT op", async () => {
    await router.handle({ id: "5", type: "agent.interrupt", agentId: "a1", data: {} }, send);
    assert.equal(channel.send.mock.calls[0].arguments[0].type, OpType.INTERRUPT);
  });

  it("agent.shutdown calls pool.shutdown and responds", async () => {
    await router.handle({ id: "6", type: "agent.shutdown", agentId: "a1", data: {} }, send);
    assert.equal(pool.shutdown.mock.callCount(), 1);
    assert.equal(sent[0].type, "agent.shutdown");
  });

  it("AGENT_NOT_FOUND error for unknown agentId", async () => {
    await router.handle({ id: "7", type: "agent.message", agentId: "bad", data: {} }, send);
    assert.equal(sent[0].type, "agent.error");
    assert.equal(sent[0].data.code, "AGENT_NOT_FOUND");
  });

  it("INVALID_MESSAGE error for unknown type", async () => {
    await router.handle({ id: "8", type: "bogus", data: {} }, send);
    assert.equal(sent[0].type, "agent.error");
    assert.equal(sent[0].data.code, "INVALID_MESSAGE");
  });
});
