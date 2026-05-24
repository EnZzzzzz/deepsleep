import { OpType, EventType } from "../protocol/types.js";
import { runTurn } from "../agent/runner.js";

/**
 * Op 分发循环 — 持续从 channel 接收 Op 并处理
 *
 * @param {{
 *   session: import("./session.js").Session,
 *   rxSub: { recv: () => Promise<{type: string, data?: any}> },
 * }} opts
 */
export async function submissionLoop({ session, rxSub }) {
  let running = true;

  while (running) {
    const op = await rxSub.recv();

    switch (op.type) {
      case OpType.USER_INPUT: {
        const userContent = op.data?.content || "";
        session.inputQueue.enqueue({
          role: "user",
          content: userContent,
        });
        const response = await runTurn({ session });
        // Append to conversation history so the next turn has context
        session.addToHistory("user", userContent);
        session.addToHistory("assistant", response);
        break;
      }

      case OpType.INTERRUPT: {
        session.handleEvent({
          type: EventType.TURN_ABORTED,
          reason: "interrupted",
        });
        break;
      }

      case OpType.SHUTDOWN: {
        session.handleEvent({ type: EventType.SHUTDOWN_COMPLETE });
        running = false;
        break;
      }

      case OpType.INTER_AGENT_COMM: {
        const mailContent = op.data?.content || "";
        session.inputQueue.enqueueMailbox({
          from: op.data?.from || "unknown",
          content: mailContent,
          triggerTurn: op.data?.triggerTurn || false,
        });
        if (op.data?.triggerTurn) {
          const response = await runTurn({ session });
          session.addToHistory("user", `[From ${op.data?.from || "unknown"}]: ${mailContent}`);
          session.addToHistory("assistant", response);
        }
        break;
      }

      default:
        // unknown op — ignore
        break;
    }
  }
}

/**
 * 创建一个简单的内存 channel
 * @returns {{ send: (op: any) => void, recv: () => Promise<any>, close: () => void }}
 */
export function createChannel() {
  /** @type {Array<{resolve: (v: any) => void, reject: (e: any) => void}>} */
  let waiters = [];
  /** @type {Array<any>} */
  let buffer = [];
  let closed = false;

  return {
    send(op) {
      if (closed) return;
      if (waiters.length > 0) {
        const w = waiters.shift();
        w.resolve(op);
      } else {
        buffer.push(op);
      }
    },
    recv() {
      if (buffer.length > 0) {
        return Promise.resolve(buffer.shift());
      }
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    close() {
      closed = true;
      for (const w of waiters) {
        w.resolve(null);
      }
      waiters = [];
    },
  };
}
