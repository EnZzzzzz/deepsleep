import { EventType } from "../protocol/types.js";

/**
 * Execute one Turn — complete a single ReAct cycle.
 *
 * Flow:
 *   1. drain input (user messages + inter-agent mail)
 *   2. build prompt
 *   3. call provider, get stream
 *   4. if model requests tool calls, execute them, go back to step 3
 *   5. if model returns final message, turn complete
 *
 * @param {{
 *   session: import("../session/session.js").Session,
 *   providerId?: string,
 *   maxTurns?: number,
 *   tools?: Array<any>,
 * }} opts
 * @returns {Promise<string>} last agent message
 */
export async function runTurn({ session, providerId, maxTurns = 50, tools = [] }) {
  session.handleEvent({ type: EventType.TURN_STARTED });

  const provider = providerId
    ? session.registry.get(providerId)
    : session.registry.getDefault(session.registry.listIds()[0]);

  if (!provider) {
    session.handleEvent({ type: EventType.ERROR, message: "No provider configured" });
    return "";
  }

  let lastAgentMessage = "";
  let turnCount = 0;

  try {
    while (turnCount < maxTurns) {
      turnCount++;

      const inputs = session.inputQueue.drain();
      const mailbox = session.inputQueue.drainMailbox();

      const messages = [];

      // 第一轮折叠历史对话（tool call 迭代不需要重复加）
      if (turnCount === 1) {
        for (const h of session.getHistory()) {
          messages.push(h);
        }
      }

      for (const item of inputs) {
        messages.push(item);
      }
      for (const mail of mailbox) {
        messages.push({ role: "user", content: `[From ${mail.from}]: ${mail.content}` });
      }

      if (messages.length === 0 && turnCount === 1) {
        session.handleEvent({ type: EventType.ERROR, message: "No input to process" });
        return "";
      }

      if (messages.length === 0) {
        break;
      }

      let needsFollowUp = false;
      for await (const event of provider.chat(messages, { tools })) {
        if (event.type === "text" || event.type === "content_block_delta") {
          lastAgentMessage += event.content || "";
        }
        if (event.type === "tool_use") {
          needsFollowUp = true;
          session.inputQueue.enqueue({
            role: "tool",
            content: JSON.stringify({ tool: event.tool, result: "..." }),
          });
        }
      }

      if (!needsFollowUp) {
        break;
      }
    }

    session.handleEvent({ type: EventType.TURN_COMPLETE, message: lastAgentMessage });
  } catch (err) {
    session.handleEvent({
      type: EventType.ERROR,
      message: err.message,
    });
  }

  return lastAgentMessage;
}
