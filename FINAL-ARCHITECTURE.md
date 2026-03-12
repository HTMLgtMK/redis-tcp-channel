# Redis Channel 最终架构

## 📐 三层架构

```
┌─────────────────────────────────────────────────┐
│  Application Layer (app-layer/)                 │
│  - 处理业务消息                                  │
│  - 与 agent 集成                                  │
├─────────────────────────────────────────────────┤
│  TCP Layer (tcp-layer/)                         │
│  - seq/ack、重传、连接管理                       │
├─────────────────────────────────────────────────┤
│  IP Layer (ip-layer/)                           │
│  - Redis Pub/Sub                                │
└─────────────────────────────────────────────────┘
```

## 🔄 SessionKey 管理

### 两种场景

#### 场景 1: webchat 用户 ↔ agent

```
webchat 用户："你好"
    ↓
OpenClaw Core
    ↓ 自动生成 SessionKey: "webchat:user123:1710156000"
    ↓
redis-channel (sendText)
    ↓ SessionKey = ctx.SessionKey
    ↓ connectionId = tcp-SessionKey
    ↓
TCP Layer → Redis Pub/Sub
```

**SessionKey 来源**: OpenClaw Core 自动生成

---

#### 场景 2: agent ↔ agent (GWork ↔ GBOT)

```
GWork 发送："你好 GBOT"
    ↓
生成 sessionId: "session-gwork-gbot-1710156000"
    ↓
metadata.sessionId = "session-gwork-gbot-1710156000"
    ↓
TCP Layer → Redis Pub/Sub
    ↓
GBOT 收到
    ↓
提取 sessionId = msg.metadata.sessionId
    ↓
SessionKey = sessionId
    ↓
GBOT 回复："你好 GWork"
    ↓
metadata.sessionId = "session-gwork-gbot-1710156000" (保持相同)
    ↓
TCP Layer (复用连接) → Redis Pub/Sub
```

**SessionKey 来源**: 从消息 metadata 中提取

---

## 📊 SessionKey 提取逻辑

**文件**: `src/lib/message-dispatcher.ts`

```typescript
// 优先级：metadata.sessionId > TCP connectionId > targetSession
const sessionId = msg.metadata?.sessionId || 
                  msg.metadata?.tcp?.connection_id?.replace('tcp-', '') ||
                  targetSession;

SessionKey: sessionId,
```

**优先级说明**:
1. `metadata.sessionId` - agent 之间对话时显式指定
2. `metadata.tcp.connection_id` - TCP 连接 ID（去掉 "tcp-" 前缀）
3. `targetSession` - 默认值（如 "agent:main:main"）

---

## 🔧 会话保持机制

### 发送方 (index.ts)

```typescript
// 获取 SessionKey（OpenClaw 自动提供）
const sessionKey = ctxAny.SessionKey || `session-${Date.now()}`;
const connectionId = `tcp-${sessionKey}`;

// 获取或创建会话
let stack = sessionMap.get(sessionKey);
if (!stack) {
  stack = createRedisChannelStack({...});
  sessionMap.set(sessionKey, stack);
  await stack.start();
}

// 发送消息
await stack.appLayer.sendMessage(appMessage);

// 30 秒后自动清理
setTimeout(async () => {
  await stack.stop();
  sessionMap.delete(sessionKey);
}, 30000);
```

### 接收方 (message-dispatcher.ts)

```typescript
// 提取 SessionKey
const sessionId = msg.metadata?.sessionId || 
                  msg.metadata?.tcp?.connection_id?.replace('tcp-', '') ||
                  targetSession;

// 传递给 agent（保持相同 SessionKey）
SessionKey: sessionId,
```

---

## 📝 使用示例

### webchat 场景（无需手动处理）

```
用户打开 webchat → OpenClaw 自动生成 SessionKey → 多轮对话自动保持
```

### agent 之间对话

**发送方 (GWork)**:
```typescript
await sendToRedis({
  text: "你好 GBOT",
  to: "gbot-device",
  metadata: {
    sessionId: "session-gwork-gbot-001",  // 第一次生成
  },
});
```

**接收方 (GBOT)**:
```typescript
// 自动从 metadata 提取 sessionId
// 回复时自动保持相同 sessionId
await sendToRedis({
  text: "你好 GWork",
  to: "gwork-device",
  metadata: {
    sessionId: "session-gwork-gbot-001",  // 保持相同
  },
});
```

---

## 🎯 关键特性

### ✅ 自动会话管理
- **webchat 用户**: OpenClaw Core 自动维护 SessionKey
- **agent 之间**: 从 metadata 提取，自动保持

### ✅ TCP 连接复用
- 相同 SessionKey → 复用 TCP 连接
- 30 秒无活动 → 自动清理

### ✅ 多轮对话支持
- webchat 用户多轮对话
- agent 之间多轮对话

### ✅ 向后兼容
- 普通消息（无 TCP）继续工作
- 渐进增强，需要时使用 TCP

---

## 📁 文件结构

```
src/
├── modules/
│   ├── ip-layer/
│   │   ├── types.ts
│   │   └── ip-layer.ts
│   ├── tcp-layer/
│   │   ├── types.ts
│   │   └── tcp-layer.ts
│   ├── app-layer/
│   │   └── app-layer.ts
│   └── index.ts
│
├── lib/
│   ├── message-sender.ts      # 发送消息（支持 TCP）
│   ├── message-handler.ts     # 接收消息（处理 TCP）
│   ├── message-dispatcher.ts  # 提取 SessionKey
│   └── ...
│
└── index.ts                   # 插件入口（SessionKey 管理）
```

---

## 🚀 下一步

1. ✅ 架构完成
2. ✅ 会话管理完成
3. ⏳ 实际测试
4. ⏳ 性能优化

---

**版本**: 3.0.2  
**日期**: 2026-03-11  
**状态**: ✅ 架构完成
