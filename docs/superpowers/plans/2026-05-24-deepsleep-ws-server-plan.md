# DeepSleep WebSocket Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zero-dependency WebSocket service layer (`server/`) that allows Desktop/Web GUI clients to interact with deepsleep Agent instances via a single multiplexed connection.

**Architecture:** Three new modules — AgentPool (agent lifecycle), Router (WS message ↔ internal Op translation), WsServer (WebSocket protocol + connection management) — all consumed via `server/index.js` → `startServer(port)`. Existing `deepsleep/` core is untouched.

**Tech Stack:** Node.js built-ins only — `http`, `crypto`, `events`, no npm dependencies.

---

## File Map

```
Create:  server/index.js           # startServer(port) entry point
Create:  server/agent-pool.js      # AgentPool — create/list/get/shutdown agents
Create:  server/router.js          # Router — message dispatch + event → WS push
Create:  server/ws-server.js       # WsServer — HTTP upgrade, WS framing, heartbeat
Create:  server/tests/agent-pool.test.js
Create:  server/tests/router.test.js
Create:  server/tests/ws-server.test.js
Create:  server/tests/integration.test.js
Modify:  main.js                    # Replace REPL with startServer()
```

---

### Task 1: AgentPool — unit tests

**Files:**
- Create: `server/tests/agent-pool.test.js`

- [ ] **Step 1: Write AgentPool unit tests**

```js
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { AgentPool } from "../agent-pool.js";
import { AgentStatus } from "../../deepsleep/protocol/types.js";

describe("AgentPool", () => {
  /** @type {import("../../deepsleep/config/provider.js").ProviderRegistry} */
  let registry;
  /** @type {AgentPool} */
  let pool;

  before(() => {
    // Build a real ProviderRegistry with a dummy provider for testing
    const { ProviderRegistry, Provider } = await import("../../deepsleep/config/provider.js");
    registry = new ProviderRegistry();
    registry.register(new Provider({
      id: "test", type: "test", defaultModel: "test-model", models: ["test-model"],
    }));
  });

  before(() => {
    pool = new AgentPool({ registry });
  });

  after(async () => {
    await pool.shutdownAll();
  });

  it("create returns a string agentId", () => {
    const agentId = pool.create({ providerId: "test" });
    assert.ok(typeof agentId === "string");
    assert.ok(agentId.length > 0);
  });

  it("get returns the entry for a created agent", () => {
    const agentId = pool.create({ providerId: "test" });
    const entry = pool.get(agentId);
    assert.ok(entry !== undefined);
    assert.ok(entry.session !== undefined);
    assert.ok(entry.channel !== undefined);
    assert.ok(typeof entry.channel.send === "function");
    assert.equal(typeof entry.loopPromise, "object"); // Promise
    assert.equal(entry.session.getCurrentStatus(), AgentStatus.PENDING_INIT);
  });

  it("get returns undefined for unknown agentId", () => {
    assert.equal(pool.get("nonexistent"), undefined);
  });

  it("list returns all active agents", () => {
    const id1 = pool.create({ providerId: "test" });
    const id2 = pool.create({ providerId: "test" });
    const list = pool.list();
    assert.equal(list.length, 2);
    assert.ok(list.some(a => a.agentId === id1));
    assert.ok(list.some(a => a.agentId === id2));
    assert.ok(list.every(a => a.status === AgentStatus.PENDING_INIT));
  });

  it("shutdown removes an agent and resolves its loop", async () => {
    const agentId = pool.create({ providerId: "test" });
    const entry = pool.get(agentId);
    await pool.shutdown(agentId);
    assert.equal(pool.get(agentId), undefined);
    // loopPromise should resolve after shutdown (never reject, never hang)
  });

  it("shutdownAll clears all agents", async () => {
    pool.create({ providerId: "test" });
    pool.create({ providerId: "test" });
    await pool.shutdownAll();
    assert.equal(pool.list().length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/tests/agent-pool.test.js`
Expected: FAIL — cannot import `../agent-pool.js`

---

### Task 2: AgentPool — implementation

**Files:**
- Create: `server/agent-pool.js`

- [ ] **Step 1: Write AgentPool implementation**

```js
import { randomUUID } from "node:crypto";
import { Session, InputQueue, submissionLoop, createChannel } from "../deepsleep/index.js";

export class AgentPool {
  /**
   * @param {{ registry: import("../deepsleep/config/provider.js").ProviderRegistry }} opts
   */
  constructor({ registry }) {
    this._registry = registry;
    /** @type {Map<string, { session: import("../deepsleep/session/session.js").Session, channel: ReturnType<typeof createChannel>, loopPromise: Promise<void> }>} */
    this._agents = new Map();
  }

  /**
   * @param {{ providerId?: string }} opts
   * @returns {string} agentId
   */
  create({ providerId } = {}) {
    const agentId = randomUUID();
    const emitter = new (require("node:events").EventEmitter)();
    const channel = createChannel();
    const session = new Session({
      agentId,
      agentStatus: emitter,
      registry: this._registry,
      inputQueue: new InputQueue(),
    });

    const loopPromise = submissionLoop({ session, rxSub: channel });

    this._agents.set(agentId, { session, channel, loopPromise });
    return agentId;
  }

  /**
   * @param {string} agentId
   * @returns {{ session: import("../deepsleep/session/session.js").Session, channel: ReturnType<typeof createChannel>, loopPromise: Promise<void> } | undefined}
   */
  get(agentId) {
    return this._agents.get(agentId);
  }

  /**
   * @returns {Array<{ agentId: string, status: string }>}
   */
  list() {
    return [...this._agents.entries()].map(([agentId, entry]) => ({
      agentId,
      status: entry.session.getCurrentStatus(),
    }));
  }

  /**
   * @param {string} agentId
   */
  async shutdown(agentId) {
    const entry = this._agents.get(agentId);
    if (!entry) return;
    const { OpType } = await import("../deepsleep/protocol/types.js");
    entry.channel.send({ type: OpType.SHUTDOWN });
    await entry.loopPromise;
    this._agents.delete(agentId);
  }

  async shutdownAll() {
    const ids = [...this._agents.keys()];
    await Promise.all(ids.map(id => this.shutdown(id)));
  }
}
```

Note: The `require("node:events")` above is intentional — Node.js ES modules support `require` for built-ins. Actually, let me use a cleaner approach.

**Fix:** Use `import { EventEmitter } from "node:events";` at the top.

```js
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Session, InputQueue, submissionLoop, createChannel } from "../deepsleep/index.js";
import { OpType } from "../deepsleep/protocol/types.js";

export class AgentPool {
  /**
   * @param {{ registry: import("../deepsleep/config/provider.js").ProviderRegistry }} opts
   */
  constructor({ registry }) {
    this._registry = registry;
    /** @type {Map<string, { session: import("../deepsleep/session/session.js").Session, channel: ReturnType<typeof createChannel>, loopPromise: Promise<void> }>} */
    this._agents = new Map();
  }

  create({ providerId } = {}) {
    const agentId = randomUUID();
    const emitter = new EventEmitter();
    const channel = createChannel();
    const session = new Session({
      agentId,
      agentStatus: emitter,
      registry: this._registry,
      inputQueue: new InputQueue(),
    });

    const loopPromise = submissionLoop({ session, rxSub: channel });

    this._agents.set(agentId, { session, channel, loopPromise });
    return agentId;
  }

  get(agentId) {
    return this._agents.get(agentId);
  }

  list() {
    return [...this._agents.entries()].map(([agentId, entry]) => ({
      agentId,
      status: entry.session.getCurrentStatus(),
    }));
  }

  async shutdown(agentId) {
    const entry = this._agents.get(agentId);
    if (!entry) return;
    entry.channel.send({ type: OpType.SHUTDOWN });
    await entry.loopPromise;
    this._agents.delete(agentId);
  }

  async shutdownAll() {
    const ids = [...this._agents.keys()];
    await Promise.all(ids.map(id => this.shutdown(id)));
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test server/tests/agent-pool.test.js`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/agent-pool.js server/tests/agent-pool.test.js
git commit -m "feat: add AgentPool for agent lifecycle management"
```

---

### Task 3: Router — unit tests

**Files:**
- Create: `server/tests/router.test.js`

- [ ] **Step 1: Write Router unit tests (with mocked AgentPool)**

```js
import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { Router } from "../router.js";
import { AgentStatus, EventType, OpType } from "../../deepspeech/protocol/types.js";

describe("Router", () => {
  function buildMocks() {
    const events = [];
    function send(msg) { events.push(msg); }

    const mockSession = {
      getCurrentStatus: mock.fn(() => AgentStatus.RUNNING),
      getHistory: mock.fn(() => [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]),
      onStatusChange: mock.fn(),
      onEvent: mock.fn(),
      handleEvent: mock.fn(),
      _statusEmitter: new EventEmitter(),
    };

    const mockChannel = { send: mock.fn() };

    const mockPool = {
      create: mock.fn(() => "agent-1"),
      get: mock.fn(() => ({ session: mockSession, channel: mockChannel, loopPromise: Promise.resolve() })),
      list: mock.fn(() => [{ agentId: "agent-1", status: AgentStatus.RUNNING }]),
      shutdown: mock.fn(),
    };

    return { mockPool, mockSession, mockChannel, send, events };
  }

  it("agent.create routes to pool.create and responds with agent.created", async () => {
    const { mockPool, send, events } = buildMocks();
    const router = new Router(mockPool);
    await router.handle({ id: "1", type: "agent.create", data: { providerId: "test" } }, send);

    assert.equal(mockPool.create.mock.callCount(), 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].id, "1");
    assert.equal(events[0].type, "agent.created");
    assert.equal(events[0].agentId, "agent-1");
    assert.equal(events[0].data.agentId, "agent-1");
  });

  it("agent.list responds with agent list", async () => {
    const { mockPool, send, events } = buildMocks();
    const router = new Router(mockPool);
    await router.handle({ id: "2", type: "agent.list", data: {} }, send);

    assert.equal(events.length, 1);
    assert.equal(events[0].id, "2");
    assert.equal(events[0].type, "agent.list");
    assert.deepEqual(events[0].data.agents, [{ agentId: "agent-1", status: AgentStatus.RUNNING }]);
  });

  it("agent.history responds with conversation history", async () => {
    const { mockPool, send, events } = buildMocks();
    const router = new Router(mockPool);
    await router.handle({ id: "3", type: "agent.history", agentId: "agent-1", data: {} }, send);

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "agent.history");
    assert.equal(events[0].data.messages.length, 2);
  });

  it("unknown agentId returns AGENT_NOT_FOUND error", async () => {
    const { mockPool, send, events } = buildMocks();
    mockPool.get = mock.fn(() => undefined);
    const router = new Router(mockPool);
    await router.handle({ id: "4", type: "agent.message", agentId: "bad-id", data: { content: "hi" } }, send);

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "agent.error");
    assert.equal(events[0].data.code, "AGENT_NOT_FOUND");
  });

  it("agent.message sends USER_INPUT op and forwards status pushes", async (t) => {
    const { mockPool, mockSession, mockChannel, send, events } = buildMocks();
    const router = new Router(mockPool);

    // Simulate: after channel.send, submissionLoop processes and fires TURN_COMPLETE
    mockChannel.send = mock.fn((op) => {
      // Simulate async completion after send
      setImmediate(() => {
        mockSession._statusEmitter.emit("status", AgentStatus.RUNNING);
        mockSession._statusEmitter.emit("event", { type: EventType.TURN_COMPLETE, message: "reply" });
        mockSession._statusEmitter.emit("status", AgentStatus.COMPLETED);
      });
    });

    await router.handle({ id: "5", type: "agent.message", agentId: "agent-1", data: { content: "hi" } }, send);

    // Check the op was sent
    const sentOp = mockChannel.send.mock.calls[0]?.arguments[0];
    assert.equal(sentOp.type, OpType.USER_INPUT);
    assert.equal(sentOp.data.content, "hi");

    // Check the response (last event matching agent.message response)
    const msgResponse = events.find(e => e.id === "5");
    assert.ok(msgResponse);
    assert.equal(msgResponse.type, "agent.message");
    assert.equal(msgResponse.data.message, "reply");

    // Check pushes (no id)
    const pushes = events.filter(e => e.id === undefined);
    assert.ok(pushes.some(e => e.type === "agent.status" && e.data.status === AgentStatus.RUNNING));
    assert.ok(pushes.some(e => e.type === "agent.status" && e.data.status === AgentStatus.COMPLETED));
  });
});
```

Wait — there's a typo: `../../deepspeech/protocol/types.js` should be `../../deepsleep/protocol/types.js`. Let me fix in the final plan.

Actually, let me just write the plan with correct paths. Let me also think more carefully about the router handler for agent.message. The TURN_COMPLETE event carries the message. I need to capture that.

Let me rewrite the plan more carefully.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/tests/router.test.js`
Expected: FAIL — cannot import `../router.js`

---

### Task 4: Router — implementation

**Files:**
- Create: `server/router.js`

- [ ] **Step 1: Write Router implementation**

```js
import { EventType, OpType } from "../deepsleep/protocol/types.js";

export class Router {
  /**
   * @param {import("./agent-pool.js").AgentPool} pool
   */
  constructor(pool) {
    this._pool = pool;
  }

  /**
   * Dispatch a WS message and send responses/pushes through `send`.
   * @param {{ id?: string, type: string, agentId?: string, data: any }} msg
   * @param {(msg: object) => void} send
   */
  async handle(msg, send) {
    try {
      switch (msg.type) {
        case "agent.create":
          this._handleCreate(msg, send);
          break;
        case "agent.list":
          this._handleList(msg, send);
          break;
        case "agent.history":
          this._handleHistory(msg, send);
          break;
        case "agent.message":
          await this._handleMessage(msg, send);
          break;
        case "agent.interrupt":
          this._handleInterrupt(msg, send);
          break;
        case "agent.shutdown":
          await this._handleShutdown(msg, send);
          break;
        default:
          send({ id: msg.id, type: "agent.error", data: { code: "INVALID_MESSAGE", message: `Unknown type: ${msg.type}` } });
      }
    } catch (err) {
      send({ id: msg.id, type: "agent.error", data: { code: "INTERNAL_ERROR", message: err.message } });
    }
  }

  _handleCreate(msg, send) {
    const agentId = this._pool.create({ providerId: msg.data?.providerId });
    this._bindEvents(agentId, send);
    send({ id: msg.id, type: "agent.created", agentId, data: { agentId } });
  }

  _handleList(msg, send) {
    send({ id: msg.id, type: "agent.list", data: { agents: this._pool.list() } });
  }

  _handleHistory(msg, send) {
    const entry = this._pool.get(msg.agentId);
    if (!entry) return send({ id: msg.id, type: "agent.error", agentId: msg.agentId, data: { code: "AGENT_NOT_FOUND", message: "Agent not found" } });
    send({ id: msg.id, type: "agent.history", agentId: msg.agentId, data: { messages: entry.session.getHistory() } });
  }

  async _handleMessage(msg, send) {
    const entry = this._pool.get(msg.agentId);
    if (!entry) return send({ id: msg.id, type: "agent.error", agentId: msg.agentId, data: { code: "AGENT_NOT_FOUND", message: "Agent not found" } });

    const waitForTurnEnd = new Promise((resolve) => {
      const handler = (event) => {
        if (event.type === EventType.TURN_COMPLETE || event.type === EventType.ERROR) {
          entry.session._statusEmitter.off("event", handler);
          resolve(event);
        }
      };
      entry.session._statusEmitter.on("event", handler);
    });

    entry.channel.send({ type: OpType.USER_INPUT, data: { content: msg.data?.content || "" } });
    const event = await waitForTurnEnd;

    send({
      id: msg.id,
      type: "agent.message",
      agentId: msg.agentId,
      data: { message: event.message || "" },
    });
  }

  _handleInterrupt(msg, send) {
    const entry = this._pool.get(msg.agentId);
    if (!entry) return send({ id: msg.id, type: "agent.error", agentId: msg.agentId, data: { code: "AGENT_NOT_FOUND", message: "Agent not found" } });
    entry.channel.send({ type: OpType.INTERRUPT });
  }

  async _handleShutdown(msg, send) {
    const entry = this._pool.get(msg.agentId);
    if (!entry) return send({ id: msg.id, type: "agent.error", agentId: msg.agentId, data: { code: "AGENT_NOT_FOUND", message: "Agent not found" } });
    await this._pool.shutdown(msg.agentId);
    send({ id: msg.id, type: "agent.shutdown", agentId: msg.agentId, data: { agentId: msg.agentId } });
  }

  /**
   * Bind session events → WS pushes for a newly created agent.
   */
  _bindEvents(agentId, send) {
    const entry = this._pool.get(agentId);
    if (!entry) return;

    entry.session.onStatusChange((status) => {
      send({ type: "agent.status", agentId, data: { status } });
    });

    entry.session.onEvent((event) => {
      send({ type: "agent.event", agentId, data: { event: { type: event.type, message: event.message, reason: event.reason } } });
    });
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test server/tests/router.test.js`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/router.js server/tests/router.test.js
git commit -m "feat: add Router for WS message dispatch"
```

---

### Task 5: WsServer — WebSocket protocol + connection mgmt, unit tests

**Files:**
- Create: `server/tests/ws-server.test.js`

- [ ] **Step 1: Write WsServer tests**

```js
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer } from "../index.js";

describe("WsServer", () => {
  /** @type {ReturnType<typeof startServer>} */
  let server;
  const PORT = 0; // OS-assigned

  before(async () => {
    server = await startServer(PORT);
  });

  after(() => {
    server.close();
  });

  function getPort() {
    return server.address().port;
  }

  it("responds to HTTP health check", async () => {
    const resp = await fetch(`http://localhost:${getPort()}/health`);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.status, "ok");
  });

  it("upgrades to WebSocket", async () => {
    // Manual WebSocket handshake test using Node.js http
    const { connectWs, closeWs } = await import("./helpers.mjs");
    const ws = await connectWs(getPort());
    assert.ok(ws.readyState === 1); // OPEN
    closeWs(ws);
  });

  it("receives JSON message and echoes error for unknown type", async () => {
    const { connectWs, closeWs, sendMessage, receiveMessage } = await import("./helpers.mjs");
    const ws = await connectWs(getPort());
    sendMessage(ws, JSON.stringify({ id: "1", type: "agent.list", data: {} }));
    const response = JSON.parse(await receiveMessage(ws));
    assert.equal(response.id, "1");
    assert.equal(response.type, "agent.list");
    closeWs(ws);
  });

  it("handles invalid JSON gracefully", async () => {
    const { connectWs, closeWs, receiveMessage } = await import("./helpers.mjs");
    const ws = await connectWs(getPort());
    // Send a text frame with invalid JSON
    ws.write(createTextFrame("not json"));
    const response = JSON.parse(await receiveMessage(ws));
    assert.equal(response.type, "agent.error");
    assert.equal(response.data.code, "INVALID_MESSAGE");
    closeWs(ws);
  });
});
```

Hmm, this test is getting complex because it needs actual WebSocket framing. Let me simplify: I'll write the tests against the internal `WsServer` class directly, testing the framing logic separately from the server startup.

Let me restructure: the WsServer tests should be simpler. The integration test (Task 7) will cover the full WS flow. For unit tests of ws-server.js, I'll test the framing functions directly.

Let me think about this more carefully...

Actually, the simplest approach: 
1. Unit tests for WebSocket framing helpers (parse frame, create frame, handshake)
2. Integration test for the full server (Task 7)

Let me redesign:

- [ ] **Step 1: Write WebSocket framing tests**

```js
import { describe, it } from "node:test";
import assert from "node:assert";
import { computeAcceptKey, createFrame, parseFrame } from "../ws-server.js";

describe("WebSocket framing", () => {
  it("computeAcceptKey produces correct value", () => {
    // From RFC 6455 test case
    const key = "dGhlIHNhbXBsZSBub25jZQ==";
    const accept = computeAcceptKey(key);
    assert.equal(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("createFrame produces valid text frame", () => {
    const frame = createFrame("hello", 0x1); // opcode 0x1 = text
    // First byte: FIN=1, opcode=1 → 0x81
    assert.equal(frame[0], 0x81);
    // Payload length 5
    assert.equal(frame[1], 5);
    // Payload bytes
    assert.equal(frame.slice(2).toString(), "hello");
  });

  it("createFrame produces valid close frame", () => {
    const frame = createFrame("", 0x8); // opcode 0x8 = close
    assert.equal(frame[0], 0x88);
    assert.equal(frame[1], 0);
  });

  it("createFrame produces valid ping frame", () => {
    const frame = createFrame("ping-data", 0x9); // opcode 0x9 = ping
    assert.equal(frame[0], 0x89);
    assert.equal(frame[1], 9);
    assert.equal(frame.slice(2).toString(), "ping-data");
  });

  it("parseFrame parses unmasked text frame", () => {
    const payload = Buffer.from("hello");
    const header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode, no mask
    header[1] = 5;
    const frame = Buffer.concat([header, payload]);
    const result = parseFrame(frame);
    assert.equal(result.opcode, 0x1);
    assert.equal(result.fin, true);
    assert.equal(result.payload.toString(), "hello");
  });

  it("parseFrame parses masked text frame", () => {
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const rawPayload = Buffer.from("hello");
    const maskedPayload = Buffer.alloc(5);
    for (let i = 0; i < 5; i++) maskedPayload[i] = rawPayload[i] ^ mask[i % 4];

    const header = Buffer.alloc(6);
    header[0] = 0x81; // FIN + text, no mask bit... 

    // Wait, the mask bit needs to be set for client-to-server frames
    let firstByte = 0x81; // FIN + text
    // Mask bit in the header byte
    header[0] = firstByte; // Hmm, actually I'm confusing myself
  });
});
```

OK, I'm overcomplicating this in the plan. Let me simplify the tests and present the framing logic clearly. The WebSocket protocol has:

**Handshake:**
1. Client sends HTTP upgrade request with `Sec-WebSocket-Key`
2. Server responds with 101 + `Sec-WebSocket-Accept` = base64(sha1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))

**Frame format (client → server, always masked):**
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
|     Extended payload length continued, if payload len == 127  |
+ - - - - - - - - - - - - - - - +-------------------------------+
|                               |  Masking-key, if MASK set to 1 |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------- - - - - - - - - - - - - - - - +
:                     Payload Data continued ...                :
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
|                     Payload Data (continued)                  |
+---------------------------------------------------------------+
```

**Frame format (server → client, never masked):**
Same but MASK=0, no masking key.

For the plan, let me just write clean code and not get lost in bit-level test details. The tests should verify correct behavior without being exhaustively pedantic.

Let me restart the plan writing but keep it concise and correct.

OK, I'll write the full plan now. Let me be very careful with the code quality.

For the ws-server.js, I'll have:
- `parseHandshake(req)` - extract Sec-WebSocket-Key from upgrade request
- `computeAcceptKey(key)` - compute the accept value
- `sendHandshake(socket, key)` - send 101 response
- `parseFrame(buffer)` - parse an incoming frame (handle masking, extended lengths)
- `createFrame(payload, opcode)` - create an outgoing frame
- `WsServer` class - wraps http server, manages connections

Let me think about `WsServer` class design:

```js
class WsServer {
  constructor(router) {
    this._router = router;
    this._server = http.createServer(this._onRequest.bind(this));
  }
  
  async listen(port) {
    this._server.listen(port);
  }
  
  _onRequest(req, res) {
    // Health check
    if (req.url === "/health" && req.method === "GET") { ... }
    
    // WebSocket upgrade
    if (req.headers["upgrade"]?.toLowerCase() === "websocket") {
      this._handleUpgrade(req, res);
    }
    
    // 404
    res.writeHead(404).end();
  }
  
  _handleUpgrade(req, socket, head) {
    // Compute accept key, send 101
    // Set up frame reading/writing
    // On message → JSON.parse → router.handle(msg, send)
    // On close → cleanup
    // Heartbeat: 30s ping interval
  }
}
```

Wait, the HTTP upgrade API in Node.js is:
```js
server.on("upgrade", (req, socket, head) => { ... });
```

So I use the `upgrade` event, not the `request` event for WebSocket. Let me use that.

For the `send` function in ws-server, it needs to serialize to JSON and send as a WebSocket text frame.

```js
function makeSend(socket) {
  return (msg) => {
    const json = JSON.stringify(msg);
    const frame = createFrame(Buffer.from(json), 0x1);
    socket.write(frame);
  };
}
```

Let me write the plan now with all these details. I'll keep the tests simpler.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="Write">
<｜｜DSML｜｜parameter name="content" string="true"># DeepSleep WebSocket Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zero-dependency WebSocket service layer (`server/`) that allows Desktop/Web GUI clients to interact with deepsleep Agent instances via a single multiplexed connection.

**Architecture:** Three new modules — AgentPool (agent lifecycle), Router (WS ↔ internal Op translation), WsServer (WebSocket protocol + connection management) — wired together in `server/index.js`. Existing `deepsleep/` is untouched.

**Tech Stack:** Node.js built-ins only — `http`, `crypto`, `events`. No npm dependencies.

---

## File Map

```
Create:  server/index.js
Create:  server/agent-pool.js
Create:  server/router.js
Create:  server/ws-server.js
Create:  server/tests/agent-pool.test.js
Create:  server/tests/router.test.js
Create:  server/tests/integration.test.js
Modify:  main.js  (replace REPL with startServer)
```

---

### Task 1: AgentPool — unit tests

**Files:**
- Create: `server/tests/agent-pool.test.js`

- [ ] **Step 1: Write AgentPool unit tests**

```js
import { describe, it, before, after } from "node:test";
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
    // Verify loopPromise resolves — it already did since shutdown awaited it
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/tests/agent-pool.test.js`
Expected: FAIL — `Cannot find module '../agent-pool.js'`

- [ ] **Step 3: Commit (test only)**

```bash
git add server/tests/agent-pool.test.js
git commit -m "test: add AgentPool unit tests"
```

---

### Task 2: AgentPool — implementation

**Files:**
- Create: `server/agent-pool.js`

- [ ] **Step 1: Implement AgentPool**

```js
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Session, InputQueue, submissionLoop, createChannel } from "../deepsleep/index.js";
import { OpType } from "../deepsleep/protocol/types.js";

export class AgentPool {
  #registry;
  #agents = new Map();

  constructor({ registry }) {
    this.#registry = registry;
  }

  create({ providerId } = {}) {
    const agentId = randomUUID();
    const emitter = new EventEmitter();
    const channel = createChannel();
    const session = new Session({
      agentId,
      agentStatus: emitter,
      registry: this.#registry,
      inputQueue: new InputQueue(),
    });
    const loopPromise = submissionLoop({ session, rxSub: channel });
    this.#agents.set(agentId, { session, channel, loopPromise });
    return agentId;
  }

  get(agentId) {
    return this.#agents.get(agentId);
  }

  list() {
    return [...this.#agents.entries()].map(([agentId, entry]) => ({
      agentId,
      status: entry.session.getCurrentStatus(),
    }));
  }

  async shutdown(agentId) {
    const entry = this.#agents.get(agentId);
    if (!entry) return;
    entry.channel.send({ type: OpType.SHUTDOWN });
    await entry.loopPromise;
    this.#agents.delete(agentId);
  }

  async shutdownAll() {
    await Promise.all([...this.#agents.keys()].map(id => this.shutdown(id)));
  }
}
```

- [ ] **Step 2: Run agent pool tests**

Run: `node --test server/tests/agent-pool.test.js`
Expected: all 7 tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/agent-pool.js
git commit -m "feat: add AgentPool for agent lifecycle management"
```

---

### Task 3: Router — unit tests

**Files:**
- Create: `server/tests/router.test.js`

- [ ] **Step 1: Write Router unit tests**

```js
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
    // Trigger status change on the bound emitter
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
    // Simulate submissionLoop processing and completing
    channel.send = mock.fn(() => {
      setImmediate(() => {
        session._statusEmitter.emit("status", AgentStatus.RUNNING);
        session._statusEmitter.emit("event", { type: EventType.TURN_COMPLETE, message: "reply text" });
        session._statusEmitter.emit("status", AgentStatus.COMPLETED);
      });
    });
    await router.handle({ id: "4", type: "agent.message", agentId: "a1", data: { content: "hi" } }, send);
    assert.equal(channel.send.mock.callCount(), 1);
    assert.equal(channel.send.mock.calls[0].arguments[0].type, OpType.USER_INPUT);
    const response = sent.find(m => m.id === "4");
    assert.equal(response.type, "agent.message");
    assert.equal(response.data.message, "reply text");
    // Status pushes should be present
    const statusPushes = sent.filter(m => m.type === "agent.status");
    assert.ok(statusPushes.length >= 2);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/tests/router.test.js`
Expected: FAIL — `Cannot find module '../router.js'`

- [ ] **Step 3: Commit (test only)**

```bash
git add server/tests/router.test.js
git commit -m "test: add Router unit tests"
```

---

### Task 4: Router — implementation

**Files:**
- Create: `server/router.js`

- [ ] **Step 1: Implement Router**

```js
import { EventType, OpType } from "../deepsleep/protocol/types.js";

export class Router {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  async handle(msg, send) {
    try {
      switch (msg.type) {
        case "agent.create":
          this.#create(msg, send);
          break;
        case "agent.list":
          send({ id: msg.id, type: "agent.list", data: { agents: this.#pool.list() } });
          break;
        case "agent.history":
          this.#history(msg, send);
          break;
        case "agent.message":
          await this.#message(msg, send);
          break;
        case "agent.interrupt":
          this.#interrupt(msg, send);
          break;
        case "agent.shutdown":
          await this.#shutdown(msg, send);
          break;
        default:
          send({ id: msg.id, type: "agent.error", data: { code: "INVALID_MESSAGE", message: `unknown type: ${msg.type}` } });
      }
    } catch (err) {
      send({ id: msg.id, type: "agent.error", data: { code: "INTERNAL_ERROR", message: err.message } });
    }
  }

  #create(msg, send) {
    const agentId = this.#pool.create({ providerId: msg.data?.providerId });
    this.#bindEvents(agentId, send);
    send({ id: msg.id, type: "agent.created", agentId, data: { agentId } });
  }

  #history(msg, send) {
    const entry = this.#pool.get(msg.agentId);
    if (!entry) return send({ id: msg.id, type: "agent.error", agentId: msg.agentId, data: { code: "AGENT_NOT_FOUND", message: "agent not found" } });
    send({ id: msg.id, type: "agent.history", agentId: msg.agentId, data: { messages: entry.session.getHistory() } });
  }

  async #message(msg, send) {
    const entry = this.#pool.get(msg.agentId);
    if (!entry) return send({ id: msg.id, type: "agent.error", agentId: msg.agentId, data: { code: "AGENT_NOT_FOUND", message: "agent not found" } });

    const turnEnd = new Promise((resolve) => {
      const h = (event) => {
        if (event.type === EventType.TURN_COMPLETE || event.type === EventType.ERROR) {
          entry.session._statusEmitter.off("event", h);
          resolve(event);
        }
      };
      entry.session._statusEmitter.on("event", h);
    });

    entry.channel.send({ type: OpType.USER_INPUT, data: { content: msg.data?.content || "" } });
    const event = await turnEnd;

    send({
      id: msg.id, type: "agent.message", agentId: msg.agentId,
      data: { message: event.message || "" },
    });
  }

  #interrupt(msg, send) {
    const entry = this.#pool.get(msg.agentId);
    if (!entry) return send({ id: msg.id, type: "agent.error", agentId: msg.agentId, data: { code: "AGENT_NOT_FOUND", message: "agent not found" } });
    entry.channel.send({ type: OpType.INTERRUPT });
  }

  async #shutdown(msg, send) {
    const entry = this.#pool.get(msg.agentId);
    if (!entry) return send({ id: msg.id, type: "agent.error", agentId: msg.agentId, data: { code: "AGENT_NOT_FOUND", message: "agent not found" } });
    await this.#pool.shutdown(msg.agentId);
    send({ id: msg.id, type: "agent.shutdown", agentId: msg.agentId, data: { agentId: msg.agentId } });
  }

  #bindEvents(agentId, send) {
    const entry = this.#pool.get(agentId);
    if (!entry) return;
    entry.session.onStatusChange((status) => {
      send({ type: "agent.status", agentId, data: { status } });
    });
    entry.session.onEvent((event) => {
      send({ type: "agent.event", agentId, data: { event: { type: event.type, message: event.message, reason: event.reason } } });
    });
  }
}
```

- [ ] **Step 2: Run router tests**

Run: `node --test server/tests/router.test.js`
Expected: all 9 tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/router.js
git commit -m "feat: add Router for WS message dispatch and event push"
```

---

### Task 5: WsServer — WebSocket protocol + server

**Files:**
- Create: `server/ws-server.js`

- [ ] **Step 1: Implement WsServer with WebSocket framing and heartbeat**

```js
import http from "node:http";
import crypto from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xA;

export function computeAcceptKey(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

export function createFrame(payload, opcode) {
  const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = payloadBuf.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payloadBuf]);
}

export function parseFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const fin = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  const maskOffset = offset;
  if (masked) offset += 4;

  if (buffer.length < offset + payloadLen) return null;

  let payload = buffer.subarray(offset, offset + payloadLen);
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      payload[i] = buffer[maskOffset + 4 + i] ^ mask[i % 4];
    }
  }

  return { fin, opcode, payload, consumed: offset + payloadLen };
}

export function createWsServer(router) {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404).end();
  });

  server.on("upgrade", (req, socket, head) => {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = computeAcceptKey(key);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      "\r\n"
    );

    const send = (msg) => {
      try {
        const frame = createFrame(JSON.stringify(msg), OP_TEXT);
        socket.write(frame);
      } catch { /* socket may be closed */ }
    };

    let buf = Buffer.alloc(0);
    const heartbeat = setInterval(() => {
      socket.write(createFrame("", OP_PING));
    }, 30000);

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      while (buf.length > 0) {
        const frame = parseFrame(buf);
        if (!frame) break;

        if (frame.opcode === OP_PONG) {
          buf = buf.subarray(frame.consumed);
          continue;
        }

        if (frame.opcode === OP_CLOSE) {
          socket.write(createFrame("", OP_CLOSE));
          socket.destroy();
          return;
        }

        if (frame.opcode === OP_TEXT && frame.fin) {
          try {
            const msg = JSON.parse(frame.payload.toString());
            router.handle(msg, send);
          } catch {
            send({ type: "agent.error", data: { code: "INVALID_MESSAGE", message: "invalid JSON" } });
          }
        }

        buf = buf.subarray(frame.consumed);
      }
    });

    socket.on("close", () => {
      clearInterval(heartbeat);
    });

    socket.on("error", () => {
      clearInterval(heartbeat);
      socket.destroy();
    });
  });

  return server;
}
```

- [ ] **Step 2: Verify the file parses without syntax errors**

Run: `node -e "import('./server/ws-server.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'computeAcceptKey', 'createFrame', 'parseFrame', 'createWsServer' ]`

- [ ] **Step 3: Commit**

```bash
git add server/ws-server.js
git commit -m "feat: add WsServer with WebSocket protocol handling"
```

---

### Task 6: server/index.js — wire everything together

**Files:**
- Create: `server/index.js`

- [ ] **Step 1: Implement server entry point**

```js
import { AgentPool } from "./agent-pool.js";
import { Router } from "./router.js";
import { createWsServer } from "./ws-server.js";

export async function startServer(port = 3000, registry) {
  const pool = new AgentPool({ registry });
  const router = new Router(pool);
  const server = createWsServer(router);

  server.on("close", () => {
    pool.shutdownAll().catch(() => {});
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve(server));
    server.on("error", reject);
  });
}
```

- [ ] **Step 2: Verify import**

Run: `node -e "import('./server/index.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'startServer' ]`

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add server entry point (startServer)"
```

---

### Task 7: main.js — replace REPL with server startup

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Rewrite main.js**

Replace the entire file with:

```js
import { startServer } from "./server/index.js";
import { ProviderRegistry } from "./deepsleep/config/provider.js";
import { OpenAIProvider } from "./deepsleep/providers/openai.js";
import { AnthropicProvider } from "./deepsleep/providers/anthropic.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROVIDER_CLASSES = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
};

const API_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

async function loadConfig() {
  for (const p of [join(process.cwd(), ".deepsleep", "config.json"), join(homedir(), ".deepsleep", "config.json")]) {
    if (existsSync(p)) {
      try { return JSON.parse(await readFile(p, "utf-8")); } catch {}
    }
  }
  return null;
}

function buildRegistry(cfg) {
  const registry = new ProviderRegistry();
  const defaultProvider = process.env.DEEPSLEEP_PROVIDER || cfg.defaultProvider || "openai";

  for (const [id, pcfg] of Object.entries(cfg.providers)) {
    const ProviderClass = PROVIDER_CLASSES[pcfg.type];
    if (!ProviderClass) continue;
    const envKey = API_KEY_ENV[id] || API_KEY_ENV[pcfg.type];
    const apiKey = pcfg.apiKey || (envKey ? process.env[envKey] : "") || "";
    registry.register(new ProviderClass({ id, type: pcfg.type, apiKey, baseUrl: pcfg.baseUrl || "", defaultModel: pcfg.defaultModel, models: pcfg.models || [pcfg.defaultModel], options: pcfg.options || {} }));
    console.log(`[deepsleep] registered ${id} (${pcfg.type})${id === defaultProvider ? " [default]" : ""}`);
  }
  return registry;
}

async function main() {
  const port = parseInt(process.env.DEEPSLEEP_PORT || "3000", 10);
  const cfg = await loadConfig();
  if (!cfg) { console.error("[deepsleep] no config found"); process.exit(1); }
  const registry = buildRegistry(cfg);
  const server = await startServer(port, registry);
  console.log(`[deepsleep] WebSocket server listening on ws://localhost:${port}`);
  process.on("SIGINT", () => { server.close(); process.exit(0); });
  process.on("SIGTERM", () => { server.close(); process.exit(0); });
}

main().catch((err) => { console.error("[deepsleep] fatal:", err.message); process.exit(1); });
```

- [ ] **Step 2: Verify main.js parses**

Run: `node --check main.js`
Expected: no output (parse success)

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "refactor: replace CLI REPL with WebSocket server"
```

---

### Task 8: Integration test

**Files:**
- Create: `server/tests/integration.test.js`

- [ ] **Step 1: Write integration test (full WS flow)**

```js
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer } from "../index.js";
import { ProviderRegistry, Provider } from "../../deepsleep/config/provider.js";
import { createFrame, parseFrame, computeAcceptKey } from "../ws-server.js";
import crypto from "node:crypto";
import net from "node:net";

function wsConnect(port) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const key = crypto.randomBytes(16).toString("base64");
    socket.connect(port, "localhost", () => {
      socket.write(
        "GET / HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n" +
        "\r\n"
      );
    });

    let handshakeBuf = "";
    socket.on("data", (data) => {
      handshakeBuf += data.toString();
      if (handshakeBuf.includes("\r\n\r\n")) {
        const acceptKey = computeAcceptKey(key);
        assert.ok(handshakeBuf.includes(acceptKey));
        resolve(socket);
      }
    });
    socket.on("error", reject);
  });
}

function wsSend(socket, msg) {
  socket.write(createFrame(JSON.stringify(msg), 0x1));
}

function wsRecv(socket) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const frame = parseFrame(buf);
      if (frame && frame.opcode === 0x1 && frame.fin) {
        socket.off("data", onData);
        resolve(JSON.parse(frame.payload.toString()));
      }
    };
    socket.on("data", onData);
  });
}

describe("Integration", () => {
  let server, port, registry;

  before(async () => {
    registry = new ProviderRegistry();
    registry.register(new Provider({
      id: "test", type: "test", defaultModel: "m", models: ["m"],
    }));
    server = await startServer(0, registry);
    port = server.address().port;
  });

  after(() => { server.close(); });

  it("GET /health returns ok", async () => {
    const resp = await fetch(`http://localhost:${port}/health`);
    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { status: "ok" });
  });

  it("full create → message → shutdown cycle", async () => {
    const ws = await wsConnect(port);

    // Create agent
    wsSend(ws, { id: "1", type: "agent.create", data: { providerId: "test" } });
    const created = await wsRecv(ws);
    assert.equal(created.id, "1");
    assert.equal(created.type, "agent.created");
    const agentId = created.data.agentId;

    // Send message (will fail with no API key, but should get error event)
    wsSend(ws, { id: "2", type: "agent.message", agentId, data: { content: "hello" } });
    // Either a response or an error — both are valid since no real provider
    const msgResp = await wsRecv(ws);
    assert.ok(msgResp.id === "2" || (msgResp.type === "agent.error"));

    // List agents
    wsSend(ws, { id: "3", type: "agent.list", data: {} });
    const listResp = await wsRecv(ws);
    assert.equal(listResp.type, "agent.list");
    assert.ok(listResp.data.agents.some(a => a.agentId === agentId));

    // Get history
    wsSend(ws, { id: "4", type: "agent.history", agentId, data: {} });
    const histResp = await wsRecv(ws);
    assert.equal(histResp.type, "agent.history");

    // Shutdown
    wsSend(ws, { id: "5", type: "agent.shutdown", agentId, data: {} });
    const shutResp = await wsRecv(ws);
    assert.equal(shutResp.type, "agent.shutdown");

    // Verify pool is empty
    wsSend(ws, { id: "6", type: "agent.list", data: {} });
    const list2 = await wsRecv(ws);
    assert.equal(list2.data.agents.length, 0);

    ws.destroy();
  });

  it("invalid JSON returns error", async () => {
    const ws = await wsConnect(port);
    // Send raw non-JSON text
    ws.write(createFrame("{{{bad json", 0x1));
    const resp = await wsRecv(ws);
    assert.equal(resp.type, "agent.error");
    assert.equal(resp.data.code, "INVALID_MESSAGE");
    ws.destroy();
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `node --test server/tests/integration.test.js`
Expected: all 3 tests PASS

- [ ] **Step 3: Run full test suite**

Run: `node --test tests/ server/tests/`
Expected: all existing tests PASS + all new tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/tests/integration.test.js
git commit -m "test: add WebSocket integration test"
```
