# DeepSleep WebSocket 服务层设计

> 版本: 0.1.0 | 日期: 2026-05-24 | 状态: Draft

---

## 1. 概述

为 DeepSleep 核心库添加 WebSocket 服务层，使 Desktop/Web GUI 可以通过 WebSocket 连接操控 Agent 实例。核心库（`deepsleep/`）零改动，新增 `server/` 目录作为独立消费者。

### 1.1 需求来源

- 客户端：未来的 Desktop GUI 和 Web GUI
- 单 WebSocket 连接，多 Agent 多路复用（通过 `agentId` 路由）
- 协议风格：基于现有 `{type, data}` 扩展，后续按需演进

### 1.2 能力覆盖

| 能力 | WS 消息类型 |
|------|------------|
| 对话交互 + 历史 | `agent.message`, `agent.history` |
| 状态 & 事件推送 | `agent.status`, `agent.event`, `agent.stream` |
| Agent 生命周期管理 | `agent.create`, `agent.interrupt`, `agent.shutdown`, `agent.list` |
| 多 Agent 协作 | 复用现有 inter-agent 通信，通过 WS 触发 `agent.comm` |

---

## 2. 模块结构

```
server/                       # 新增，与 deepsleep/ 同级
├── index.js                  # 导出 startServer(port)
├── ws-server.js              # WebSocket 连接管理
├── agent-pool.js             # Agent 实例池
└── router.js                 # 消息路由（WS ↔ 内部 Op）

main.js                       # 入口改为调用 startServer()
deepsleep/                    # 核心库，零改动
```

依赖方向：`main.js → server/ → deepsleep/`

`server/` 通过 `deepsleep/index.js` 的公开 API 消费所有能力，不直接引用内部模块。

---

## 3. 消息协议

### 3.1 通用信封

```js
// 请求（GUI → Server）
{ id: "1", type: "agent.message", agentId: "abc", data: { content: "hi" } }

// 响应（Server → GUI）
{ id: "1", type: "agent.message", agentId: "abc", data: { message: "hello" } }

// 推送（Server → GUI，无 id）
{ type: "agent.status", agentId: "abc", data: { status: "running" } }
```

- `id`：请求-响应匹配，推送无此字段
- `type`：`domain.action` 命名
- `agentId`：AgentPool 分配的标识，用于多路复用路由
- `data`：负载，结构和 type 关联

### 3.2 消息类型

**Client → Server**

| type | data | 说明 |
|------|------|------|
| `agent.create` | `{ providerId? }` | 创建 Agent，返回 `agent.created` |
| `agent.message` | `{ content }` | 发送消息给 Agent |
| `agent.interrupt` | `{}` | 中断当前 turn |
| `agent.shutdown` | `{}` | 关闭并移除 Agent |
| `agent.list` | `{}` | 列出活跃 Agent |
| `agent.history` | `{}` | 获取对话历史 |
| `agent.comm` | `{ targetAgentId, content, triggerTurn? }` | Agent 间通信 |

**Server → Client（响应）**

| type | data | 触发 |
|------|------|------|
| `agent.created` | `{ agentId }` | `agent.create` |
| `agent.message` | `{ message }` | `agent.message` 完成 |
| `agent.shutdown` | `{ agentId }` | `agent.shutdown` |
| `agent.list` | `{ agents: [{agentId, status}] }` | `agent.list` |
| `agent.history` | `{ messages: [{role, content}] }` | `agent.history` |
| `agent.error` | `{ code, message }` | 任意请求失败 |

**Server → Client（推送，无 id）**

| type | data | 触发 |
|------|------|------|
| `agent.status` | `{ agentId, status }` | 状态变更 |
| `agent.event` | `{ agentId, event: {type, message?} }` | turn 开始/结束、错误 |
| `agent.stream` | `{ agentId, delta }` | 模型输出增量文本 |

### 3.3 错误码

| code | 含义 |
|------|------|
| `AGENT_NOT_FOUND` | agentId 不存在 |
| `AGENT_NOT_RUNNING` | Agent 已处于终态 |
| `INVALID_MESSAGE` | 消息格式错误 |
| `INTERNAL_ERROR` | 服务端内部错误 |

---

## 4. 核心组件

### 4.1 AgentPool

```js
class AgentPool {
  constructor()                           // Map<agentId, AgentEntry>
  create({ providerId }) → string        // 生成 UUID → 创建 Session + channel → 启动 submissionLoop
  get(agentId) → AgentEntry | undefined
  list() → Array<{ agentId, status }>
  shutdown(agentId) → void               // channel.send(SHUTDOWN) → 等待 loop 结束 → 移除
  shutdownAll() → void                   // 服务停止时清理
}
```

- `AgentEntry = { session, channel, loopPromise, providerId }`
- `create` 时启动 `submissionLoop`，loop 在后台异步运行
- agentId 由 `crypto.randomUUID()` 生成
- `shutdown` 发送 SHUTDOWN op 并等待 loop 自然结束，不强制终止

### 4.2 Router

```js
class Router {
  constructor(pool)
  async handle(wsMsg, send) → void       // 主分发入口
  bindEvents(agentId, entry, send)        // 绑定内部 EventEmitter → WS 推送
}
```

处理逻辑：

```
handle({id, type, agentId, data}, send):
  switch type:
    agent.create:
      agentId = pool.create(data)
      send({id, type:"agent.created", agentId, data:{agentId}})
      bindEvents(agentId, pool.get(agentId), send)

    agent.message / agent.interrupt / agent.shutdown:
      entry = pool.get(agentId)
      if !entry → send({id, type:"agent.error", data:{code:"AGENT_NOT_FOUND"}})
      entry.channel.send(opFrom(msg))  // 映射到内部 OpType
      response = await waitForTurnCompletion(entry)
      send({id, type: responseType, agentId, data: responseData})

    agent.list:
      send({id, type:"agent.list", data:{agents: pool.list()}})

    agent.history:
      send({id, type:"agent.history", data:{messages: entry.session.getHistory()}})
```

### 4.3 WsServer

```js
startServer(port):
  http.createServer()
  upgrade 到 WebSocket
  每个连接实例化 Router
  消息接收 → JSON.parse → router.handle()
  连接关闭 → 标记 Agent 为可重连（不立即销毁）
```

- 无第三方依赖，使用 Node.js 内置 `http` 模块 + 手动 WebSocket 升级
- 心跳：30s ping/pong，超时断开
- 断线：Agent 保留在 pool 中，支持 GUI 重连后恢复

### 4.4 数据流

```
GUI (Desktop/Web) ── ws ──→ WsServer
                               │ msg
                               ▼
                             Router.handle()
                               │
                    ┌──────────┼──────────┐
                    │          │          │
                    ▼          ▼          ▼
              agent.create  agent.msg  agent.list
                    │          │          │
                    ▼          ▼          │
              AgentPool    entry.channel  │
                    │       .send(Op)     │
                    ▼          │          │
              Session +       │          └── pool.list()
              submissionLoop  │
                              ▼
                       内部 event
                              │
                        bindEvents() → send() → WS 推送
```

---

## 5. 连接生命周期

```
GUI 连接 → ws-server 接受 → Router 实例化
  │
  ├─ agent.create → pool.create → bindEvents → 推送流开始
  │     │
  │     ├─ agent.message → channel.send(USER_INPUT) → runTurn
  │     │   → event.streams (流式文本推送)
  │     │   → agent.status: completed
  │     │   → agent.message response (完整回复)
  │     │
  │     └─ agent.shutdown → channel.send(SHUTDOWN)
  │         → pool 移除 → agent.shutdown response
  │
  └─ GUI 断开 → ws 连接关闭，Agent 保留在 pool
      GUI 重连 → 可通过 agentId 继续操作已有 Agent
```

- Agent 不会因 WS 断线而自动关闭
- 超过 TTL（默认 30 分钟无活动）由 pool 兜底清理
- 服务进程退出时 `pool.shutdownAll()`

---

## 6. 测试策略

| 层级 | 测试内容 | 方式 |
|------|---------|------|
| AgentPool | create/list/shutdown/shutdownAll | 单元测试 |
| Router | 消息类型分发、错误响应格式 | 单元测试，mock pool |
| WsServer | 连接建立/断开、心跳、JSON 解析错误 | 集成测试，`ws` 库连接 |
| 端到端 | 完整 create → message → shutdown 流程 | 集成测试，真实 deepsleep |

测试目录：`server/tests/`，使用 Node.js 内置 `node:test`，和现有测试风格一致。

---

## 7. 与现有代码的关系

| 文件 | 改动 |
|------|------|
| `deepsleep/` | **零改动** |
| `main.js` | 移除 REPL/one-shot 逻辑，改为 `startServer(port)` |
| `package.json` | 无新增依赖 |
| `server/` | 全部新增 |
| `tests/` | 保留现有测试，新增 `server/tests/` |
