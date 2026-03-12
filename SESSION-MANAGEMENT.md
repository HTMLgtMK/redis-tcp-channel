# 会话管理设计

## 🎯 问题

**agent 处理需要保持会话 ID，而 webchat 基本上是新会话可能不带会话 ID**

## 📐 解决方案

### 1. 会话 ID 生成策略

```typescript
// 优先级：metadata.sessionId > SessionKey > 自动生成
let sessionId = ctx.metadata?.sessionId || ctx.SessionKey;

if (!sessionId) {
  // webchat 新会话：生成新的 sessionId
  sessionId = `session-${Date.now()}-${randomString()}`;
} else {
  // agent 保持会话：使用已有 sessionId
  debugLog(`agent 保持会话：sessionId=${sessionId}`);
}
```

### 2. 会话保持机制

```
webchat 用户发送消息
    ↓
生成 sessionId (session-1710156000-abc123)
    ↓
创建 TCP 连接 (connectionId = tcp-session-1710156000-abc123)
    ↓
发送消息（携带 sessionId）
    ↓
接收方处理
    ↓
agent 响应（从 SessionKey 获取 sessionId）
    ↓
复用已有 TCP 连接
    ↓
发送回复（携带相同 sessionId）
```

### 3. 会话管理器

```typescript
// 全局会话映射
const sessionMap = new Map<string, RedisChannelStack>();

// 获取或创建会话
let stack = sessionMap.get(sessionId);
if (!stack) {
  stack = createRedisChannelStack({...});
  sessionMap.set(sessionId, stack);
  await stack.start();
}

// 发送消息
await stack.appLayer.sendMessage(appMessage);

// 定时清理（默认 30 秒）
setTimeout(async () => {
  await stack.stop();
  sessionMap.delete(sessionId);
}, keepAliveMs);
```

## 🔄 数据流

### 发送方（webchat 首次消息）

```
webchat 用户："你好"
    ↓
index.ts:sendText()
    ↓
检测无 sessionId → 生成 session-1710156000-abc123
    ↓
创建 RedisChannelStack
  - connectionId: tcp-session-1710156000-abc123
  - isInitiator: true
  - initialMessage: { sessionId: 'session-1710156000-abc123' }
    ↓
启动 TCP 连接（发送 SYN + 初始消息）
    ↓
存入 sessionMap
    ↓
30 秒后自动清理
```

### 接收方（agent 处理）

```
Redis Subscribe → handleInboundMessage()
    ↓
检测到 TCP Segment
    ↓
handleTcpSegment() 提取 sessionId
    ↓
handleInboundMessageDispatch()
    ↓
SessionKey = sessionId (从 metadata 获取)
    ↓
agent 处理（保持相同 SessionKey）
```

### 发送方（agent 回复）

```
agent 回复："你好，有什么可以帮助你的？"
    ↓
index.ts:sendText()
    ↓
从 SessionKey 获取 sessionId: session-1710156000-abc123
    ↓
从 sessionMap 获取已有 stack
    ↓
复用 TCP 连接（发送 DATA）
    ↓
消息携带 sessionId
```

## 📊 消息格式

### 应用层消息（携带 sessionId）

```json
{
  "type": "message",
  "data": {
    "text": "你好",
    "timestamp": 1710156000,
    "sessionId": "session-1710156000-abc123"
  }
}
```

### TCP Segment

```json
{
  "_tcp": {
    "connection_id": "tcp-session-1710156000-abc123",
    "seq": 1,
    "ack": 2,
    "flags": ["DATA", "ACK"],
    "timestamp": 1710156000
  },
  "payload": [
    {
      "type": "message",
      "data": {
        "text": "你好",
        "sessionId": "session-1710156000-abc123"
      }
    }
  ]
}
```

## ⚙️ 配置选项

### 会话超时时间

```typescript
// 在 metadata 中设置
{
  metadata: {
    keepAliveMs: 60000,  // 60 秒（默认 30 秒）
  }
}
```

### 会话 ID 来源优先级

1. `metadata.sessionId` - 显式指定
2. `SessionKey` - OpenClaw 会话键
3. 自动生成 - webchat 新会话

## 🎯 关键代码位置

### 1. 会话 ID 生成
**文件**: `src/index.ts`  
**位置**: `sendText()` 函数

```typescript
let sessionId = ctxAny.metadata?.sessionId || ctxAny.SessionKey;
if (!sessionId) {
  sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

### 2. 会话管理
**文件**: `src/index.ts`  
**位置**: `sessionMap`

```typescript
const sessionMap = new Map<string, RedisChannelStack>();
let stack = sessionMap.get(sessionId);
```

### 3. SessionKey 传递
**文件**: `src/lib/message-dispatcher.ts`  
**位置**: `handleInboundMessageDispatch()`

```typescript
const sessionId = msg.metadata?.tcp?.connection_id || 
                  msg.metadata?.appMessage?.data?.sessionId || 
                  targetSession;

SessionKey: sessionId  // 传递给 agent
```

### 4. 会话状态维护
**文件**: `src/modules/app-layer/app-layer.ts`  
**位置**: `AppLayerImpl` 类

```typescript
private sessionId: string | null = null;

// 从初始数据或接收数据中提取
if (initialData?.data?.sessionId) {
  this.sessionId = initialData.data.sessionId;
}

// 发送时自动携带
if (!data.data.sessionId && this.sessionId) {
  data.data.sessionId = this.sessionId;
}
```

## 📝 注意事项

1. **webchat 新会话**: 每次 webchat 用户首次发消息都会生成新的 sessionId
2. **agent 保持会话**: agent 响应时使用相同的 SessionKey，复用 TCP 连接
3. **超时清理**: 默认 30 秒后自动关闭连接，避免资源占用
4. **并发会话**: sessionMap 支持多个并发会话，每个 sessionId 独立

---

**版本**: 3.0.1  
**日期**: 2026-03-11  
**状态**: ✅ 会话管理完成
