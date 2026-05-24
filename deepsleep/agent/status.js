// deepsleep/agent/status.js
import { AgentStatus, EventType, TurnAbortReason } from "../protocol/types.js";

/**
 * 判断状态是否为终态（不会再流转）
 * @param {string} status
 * @returns {boolean}
 */
export function isFinal(status) {
  return ![AgentStatus.PENDING_INIT, AgentStatus.RUNNING, AgentStatus.INTERRUPTED].includes(status);
}

/**
 * 根据事件推导新的 Agent 状态
 * @param {{ type: string, reason?: string, message?: string }} event
 * @returns {string|null}
 */
export function agentStatusFromEvent(event) {
  switch (event.type) {
    case EventType.TURN_STARTED:
      return AgentStatus.RUNNING;
    case EventType.TURN_COMPLETE:
      return AgentStatus.COMPLETED;
    case EventType.TURN_ABORTED:
      if (event.reason === TurnAbortReason.INTERRUPTED ||
          event.reason === TurnAbortReason.BUDGET_LIMITED) {
        return AgentStatus.INTERRUPTED;
      }
      return AgentStatus.ERRORED;
    case EventType.ERROR:
      return AgentStatus.ERRORED;
    case EventType.SHUTDOWN_COMPLETE:
      return AgentStatus.SHUTDOWN;
    default:
      return null;
  }
}
