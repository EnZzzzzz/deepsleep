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

    this.#bindEvents(msg.agentId, send);

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
