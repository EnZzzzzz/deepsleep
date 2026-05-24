/**
 * Agent 运行状态枚举
 * 瞬态: PENDING_INIT, RUNNING, INTERRUPTED
 * 终态: COMPLETED, ERRORED, SHUTDOWN, NOT_FOUND
 */
export const AgentStatus = Object.freeze({
  PENDING_INIT:  "pending_init",
  RUNNING:       "running",
  INTERRUPTED:   "interrupted",
  COMPLETED:     "completed",
  ERRORED:       "errored",
  SHUTDOWN:      "shutdown",
  NOT_FOUND:     "not_found",
});

/**
 * 终止原因 — TurnAbortReason
 */
export const TurnAbortReason = Object.freeze({
  INTERRUPTED:      "interrupted",
  REPLACED:         "replaced",
  BUDGET_LIMITED:   "budget_limited",
  REVIEW_ENDED:     "review_ended",
});

/**
 * 内部事件类型 — 驱动状态转换
 */
export const EventType = Object.freeze({
  TURN_STARTED:       "turn_started",
  TURN_COMPLETE:      "turn_complete",
  TURN_ABORTED:       "turn_aborted",
  ERROR:              "error",
  SHUTDOWN_COMPLETE:  "shutdown_complete",
});

/**
 * 外部操作类型 — 通过 submission channel 提交
 */
export const OpType = Object.freeze({
  USER_INPUT:              "user_input",
  INTERRUPT:               "interrupt",
  SHUTDOWN:                "shutdown",
  INTER_AGENT_COMM:        "inter_agent_communication",
  SPAWN_AGENT:             "spawn_agent",
  COMPACT:                 "compact",
});

/** @typedef {typeof AgentStatus[keyof typeof AgentStatus]} AgentStatusT */
/** @typedef {typeof TurnAbortReason[keyof typeof TurnAbortReason]} TurnAbortReasonT */
/** @typedef {typeof EventType[keyof typeof EventType]} EventTypeT */
/** @typedef {typeof OpType[keyof typeof OpType]} OpTypeT */
