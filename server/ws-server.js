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
  const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf-8");
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
  const opcode = firstByte & 0x0f;
  const fin = (firstByte & 0x80) !== 0;
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
    const unmasked = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      unmasked[i] = payload[i] ^ mask[i % 4];
    }
    payload = unmasked;
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

    let buf = head;
    let lastPong = Date.now();
    const PONG_TIMEOUT = 10000; // 10s without pong → disconnect

    const heartbeat = setInterval(() => {
      if (Date.now() - lastPong > PONG_TIMEOUT) {
        clearInterval(heartbeat);
        socket.destroy();
        return;
      }
      try { socket.write(createFrame("", OP_PING)); } catch { /* socket may be gone */ }
    }, 30000);

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length > 0) {
        const frame = parseFrame(buf);
        if (!frame) break;
        if (frame.opcode === OP_PONG) {
          lastPong = Date.now();
          buf = buf.subarray(frame.consumed);
          continue;
        }
        if (frame.opcode === OP_PING) {
          try { socket.write(createFrame(frame.payload, OP_PONG)); } catch {}
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

    socket.on("close", () => clearInterval(heartbeat));
    socket.on("error", () => { clearInterval(heartbeat); socket.destroy(); });
  });

  return server;
}
