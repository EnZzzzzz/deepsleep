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
    this.#agents.set(agentId, { session, channel, loopPromise, providerId });
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
    try {
      await entry.loopPromise;
    } finally {
      this.#agents.delete(agentId);
    }
  }

  async shutdownAll() {
    await Promise.all([...this.#agents.keys()].map(id => this.shutdown(id)));
  }
}
