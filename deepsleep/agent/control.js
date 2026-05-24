import { AgentStatus, EventType, OpType } from "../protocol/types.js";
import { agentStatusFromEvent } from "./status.js";

export class AgentControl {
  /**
   * @param {{
   *   agentId: string,
   *   statusEmitter: import("node:events").EventEmitter,
   *   inputQueue: import("../session/input-queue.js").InputQueue,
   *   spawner: ((config: any) => Promise<AgentControl>)|null,
   * }} opts
   */
  constructor({ agentId, statusEmitter, inputQueue, spawner }) {
    this.agentId = agentId;
    this._statusEmitter = statusEmitter;
    this._inputQueue = inputQueue;
    this._spawner = spawner;
  }

  /**
   * Subscribe to status changes for the current Agent
   * @param {(status: string) => void} callback
   * @returns {() => void} unsubscribe function
   */
  subscribeStatus(callback) {
    this._statusEmitter.on("status", callback);
    return () => this._statusEmitter.off("status", callback);
  }

  /**
   * Send a message to another Agent
   * @param {string} targetAgentId
   * @param {string} content
   * @param {boolean} triggerTurn
   */
  sendInterAgentMessage(targetAgentId, content, triggerTurn = false) {
    this._inputQueue.enqueueMailbox({
      from: targetAgentId,
      content,
      triggerTurn,
    });
  }

  /**
   * Spawn a child Agent
   * @param {{ agentId: string, providerId?: string, maxTurns?: number }} config
   * @returns {Promise<AgentControl>}
   */
  async spawnAgent(config) {
    if (!this._spawner) {
      throw new Error("spawner not configured");
    }
    return this._spawner(config);
  }

  /**
   * Shutdown the current Agent
   */
  shutdown() {
    this._statusEmitter.emit("status", AgentStatus.ERRORED);
  }
}
