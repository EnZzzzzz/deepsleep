import { AgentStatus } from "../protocol/types.js";
import { agentStatusFromEvent } from "../agent/status.js";

export class Session {
  /**
   * @param {{
   *   agentId: string,
   *   agentStatus: import("node:events").EventEmitter,
   *   registry: import("../config/provider.js").ProviderRegistry,
   *   inputQueue: import("./input-queue.js").InputQueue,
   * }} opts
   */
  constructor({ agentId, agentStatus, registry, inputQueue }) {
    this.agentId = agentId;
    /** @type {import("node:events").EventEmitter} */
    this._statusEmitter = agentStatus;
    this.registry = registry;
    this.inputQueue = inputQueue;
    /** @type {string} */
    this._currentStatus = AgentStatus.PENDING_INIT;
    /** @type {Array<{role: string, content: string}>} conversation history */
    this._history = [];
  }

  /**
   * 处理事件，推导并广播新状态
   * @param {{ type: string, reason?: string, message?: string }} event
   * @returns {string} 新状态
   */
  handleEvent(event) {
    const newStatus = agentStatusFromEvent(event);
    if (newStatus && newStatus !== this._currentStatus) {
      this._currentStatus = newStatus;
      this._statusEmitter.emit("status", newStatus);
    }
    // 广播带内容的完整事件，供外部消费（TURN_COMPLETE 时拿到回复文本）
    this._statusEmitter.emit("event", event);
    return this._currentStatus;
  }

  /** @returns {string} */
  getCurrentStatus() {
    return this._currentStatus;
  }

  /** @returns {boolean} */
  isRunning() {
    return this._currentStatus === AgentStatus.RUNNING ||
           this._currentStatus === AgentStatus.INTERRUPTED;
  }

  /**
   * 订阅状态变更
   * @param {(status: string) => void} callback
   */
  onStatusChange(callback) {
    this._statusEmitter.on("status", callback);
  }

  /**
   * 订阅所有事件（包含 message 内容）
   * @param {(event: { type: string, reason?: string, message?: string }) => void} callback
   */
  onEvent(callback) {
    this._statusEmitter.on("event", callback);
  }

  /**
   * 追加一条消息到对话历史
   * @param {string} role
   * @param {string} content
   */
  addToHistory(role, content) {
    this._history.push({ role, content });
  }

  /**
   * 获取完整对话历史（按时间顺序）
   * @returns {Array<{role: string, content: string}>}
   */
  getHistory() {
    return this._history;
  }

  /** 清空对话历史 */
  clearHistory() {
    this._history = [];
  }
}
