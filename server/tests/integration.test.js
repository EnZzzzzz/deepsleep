import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createWsServer, createFrame, parseFrame, computeAcceptKey } from "../ws-server.js";
import { Router } from "../router.js";
import { AgentPool } from "../agent-pool.js";
import { ProviderRegistry, Provider } from "../../deepsleep/config/provider.js";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";

/**
 * Create a pair of mock sockets connected via EventEmitter.
 * Each socket.write() delivers data to the other side's "data" listeners
 * on the next tick (via process.nextTick).
 */
function createSocketPair() {
  const serverSocket = new EventEmitter();
  const clientSocket = new EventEmitter();

  serverSocket.write = (data) => {
    const buf = Buffer.from(data);
    process.nextTick(() => clientSocket.emit("data", buf));
  };
  clientSocket.write = (data) => {
    const buf = Buffer.from(data);
    process.nextTick(() => serverSocket.emit("data", buf));
  };

  const noop = () => {};
  serverSocket.destroy = noop;
  serverSocket.end = noop;
  serverSocket.setMaxListeners = noop;
  clientSocket.destroy = noop;
  clientSocket.end = noop;
  clientSocket.setMaxListeners = noop;

  return { serverSocket, clientSocket };
}

/**
 * Perform a WebSocket upgrade handshake via mock sockets.
 * Emits the "upgrade" event on the server, then consumes the
 * HTTP 101 response on the client side.
 */
async function wsConnectMock(server) {
  const { serverSocket, clientSocket } = createSocketPair();
  const key = crypto.randomBytes(16).toString("base64");

  const req = { headers: { "sec-websocket-key": key } };
  server.emit("upgrade", req, serverSocket, Buffer.alloc(0));

  // Read the HTTP 101 handshake response
  const handshake = await new Promise((resolve) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\r\n\r\n")) {
        clientSocket.off("data", onData);
        resolve(buf);
      }
    };
    clientSocket.on("data", onData);
  });

  const acceptKey = computeAcceptKey(key);
  assert.ok(handshake.includes(acceptKey), "handshake should have correct accept key");

  return clientSocket;
}

function wsSend(socket, msg) {
  socket.write(createFrame(JSON.stringify(msg), 0x1));
}

/**
 * Create a buffered WS message reader.
 * Accumulates all incoming text frames and provides a read()
 * method that returns the next message (buffered or future).
 */
function wsCreateReader(socket) {
  let buf = Buffer.alloc(0);
  const queue = [];
  let resolvers = [];

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length > 0) {
      const frame = parseFrame(buf);
      if (!frame) break;
      if (frame.opcode === 0x1 && frame.fin) {
        const msg = JSON.parse(frame.payload.toString());
        buf = buf.subarray(frame.consumed);
        if (resolvers.length > 0) {
          resolvers.shift()(msg);
        } else {
          queue.push(msg);
        }
      } else {
        buf = buf.subarray(frame.consumed);
      }
    }
  });

  return {
    read() {
      return new Promise((resolve) => {
        if (queue.length > 0) {
          resolve(queue.shift());
        } else {
          resolvers.push(resolve);
        }
      });
    },
  };
}

describe("Integration", () => {
  let pool, router, server, registry;

  before(() => {
    registry = new ProviderRegistry();
    registry.register(new Provider({
      id: "test", type: "test", defaultModel: "m", models: ["m"],
    }));
    pool = new AgentPool({ registry });
    router = new Router(pool);
    server = createWsServer(router);
  });

  after(async () => {
    await pool.shutdownAll();
  });

  it("GET /health returns ok", async () => {
    let status, body;
    const res = {
      writeHead(s) { status = s; },
      end(b) { body = b; },
    };
    server.emit("request", { url: "/health", method: "GET" }, res);
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(body), { status: "ok" });
  });

  it("full create -> list -> history -> shutdown cycle", async () => {
    const ws = await wsConnectMock(server);
    const reader = wsCreateReader(ws);

    // Create agent
    wsSend(ws, { id: "1", type: "agent.create", data: { providerId: "test" } });
    const created = await reader.read();
    assert.equal(created.id, "1");
    assert.equal(created.type, "agent.created");
    const agentId = created.data.agentId;
    assert.ok(typeof agentId === "string");

    // List agents
    wsSend(ws, { id: "2", type: "agent.list", data: {} });
    const listResp = await reader.read();
    assert.equal(listResp.type, "agent.list");
    assert.ok(listResp.data.agents.some(a => a.agentId === agentId));

    // Get history
    wsSend(ws, { id: "3", type: "agent.history", agentId, data: {} });
    const histResp = await reader.read();
    assert.equal(histResp.type, "agent.history");
    assert.ok(Array.isArray(histResp.data.messages));

    // Shutdown -- skip any intermediate status messages
    wsSend(ws, { id: "4", type: "agent.shutdown", agentId, data: {} });
    for (;;) {
      const msg = await reader.read();
      if (msg.type === "agent.shutdown") {
        assert.equal(msg.id, "4");
        break;
      }
    }
  });

  it("invalid JSON returns INVALID_MESSAGE error", async () => {
    const ws = await wsConnectMock(server);
    const reader = wsCreateReader(ws);
    ws.write(createFrame("{{{bad json", 0x1));
    const resp = await reader.read();
    assert.equal(resp.type, "agent.error");
    assert.equal(resp.data.code, "INVALID_MESSAGE");
  });

  it("frame in head buffer is processed immediately on upgrade", async () => {
    const { serverSocket, clientSocket } = createSocketPair();
    const key = crypto.randomBytes(16).toString("base64");

    // Build a masked WebSocket frame for agent.list
    const payload = JSON.stringify({ id: "h1", type: "agent.list", data: {} });
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload.charCodeAt(i) ^ mask[i % 4];
    }
    const frame = Buffer.alloc(2 + 4 + payload.length);
    frame[0] = 0x81;
    frame[1] = 0x80 | payload.length;
    mask.copy(frame, 2);
    masked.copy(frame, 6);

    // Capture all data sent to clientSocket
    const chunks = [];
    clientSocket.on("data", (c) => chunks.push(c));

    // Upgrade with the frame as head buffer
    const req = { headers: { "sec-websocket-key": key } };
    server.emit("upgrade", req, serverSocket, frame);

    // Wait for process.nextTick to drain (mock socket uses nextTick)
    await new Promise((r) => setTimeout(r, 0));

    // Concatenate all chunks and find WS frames after the HTTP 101
    const all = Buffer.concat(chunks);
    const bodyStart = all.indexOf("\r\n\r\n") + 4;
    assert.ok(bodyStart > 4, "handshake 101 should be present");

    // Verify handshake accept key
    assert.ok(all.subarray(0, bodyStart).toString().includes(computeAcceptKey(key)));

    // Parse WS frame (skip HTTP response bytes)
    const wsFrame = parseFrame(all.subarray(bodyStart));
    assert.ok(wsFrame, "should parse a WS frame");
    const resp = JSON.parse(wsFrame.payload.toString());
    assert.equal(resp.id, "h1");
    assert.equal(resp.type, "agent.list");
  });
});
