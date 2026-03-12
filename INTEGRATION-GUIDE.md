# Redis Channel TCP 集成指南

## ✅ 集成完成

三层架构已成功集成到 redis-channel 插件：

```
┌─────────────────────────────────────────────────┐
│  Application Layer (app-layer/)                 │
│  - 处理业务消息                                  │
│  - 与 agent 集成                                  │
├─────────────────────────────────────────────────┤
│  TCP Layer (tcp-layer/)                         │
│  - seq/ack、重传、连接管理                       │
│  - 可靠传输                                      │
├─────────────────────────────────────────────────┤
│  IP Layer (ip-layer/)                           │
│  - Redis Pub/Sub                                │
│  - 装包/拆包                                     │
└─────────────────────────────────────────────────┘
```

## 📁 修改的文件

### 1. `src/index.ts`
- ✅ 导入新模块
- ✅ 创建 sessionMap 管理 TCP 连接
- ✅ sendText 使用 TCP 层发送消息
- ✅ 自动清理超时会话（5 分钟无活动）

### 2. `src/lib/message-handler.ts`
- ✅ handleTcpSegment 处理 TCP Segment
- ✅ 提取应用层数据
- ✅ 转换为 NormalizedMessage 传递给 agent

### 3. `src/lib/message-dispatcher.ts`
- ✅ 从 metadata 提取 SessionKey
- ✅ 保持多轮对话会话

## 🔄 数据流

### 发送流程（Outbound）

```
webchat/agent
    ↓
OpenClaw Core → sendText(ctx)
    ↓ SessionKey = ctx.SessionKey
    ↓
src/index.ts
    ↓ sessionMap.get(SessionKey)
    ├─ 无 → 创建新会话 → TCP Layer → IP Layer → Redis Publish
    └─ 有 → 复用会话 → TCP Layer → IP Layer → Redis Publish
```

### 接收流程（Inbound）

```
Redis Subscribe
    ↓
src/index.ts (gateway.startAccount)
    ↓
handleInboundMessage()
    ↓ 检测 _tcp 字段
    ↓
handleTcpSegment()
    ↓ 提取应用层数据
    ↓
handleInboundMessageDispatch()
    ↓ SessionKey = metadata.tcp.connection_id
    ↓
agent (保持相同 SessionKey)
```

## 📊 SessionKey 管理

### 来源优先级

1. **webchat 用户**: OpenClaw Core 自动生成 (`ctx.SessionKey`)
2. **agent 之间**: 从 metadata 提取 (`metadata.tcp.connection_id`)
3. **默认**: `targetSession` (如 `agent:main:main`)

### 会话保持

```typescript
// 发送方
const sessionKey = ctx.SessionKey;  // OpenClaw 提供
const stack = sessionMap.get(sessionKey);
if (!stack) {
  stack = createRedisChannelStack({...});
  sessionMap.set(sessionKey, stack);
}
await stack.appLayer.sendMessage(appMessage);

// 接收方
const sessionKey = msg.metadata?.tcp?.connection_id?.replace('tcp-', '');
runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
  ctx: { SessionKey: sessionKey, ... }
});
```

## 🧪 测试方式

### 1. 模块层测试

```bash
# 终端 1：接收方
node test-tcp-stack.js --device-id=tcp-test-a --target=tcp-test-b --role=receiver

# 终端 2：发起方
node test-tcp-stack.js --device-id=tcp-test-b --target=tcp-test-a --role=initiator
```

### 2. OpenClaw 集成测试

```bash
node test-openclaw-integration.js
```

### 3. Redis 连接测试

```bash
node test-redis-connection.js
```

## ⚙️ 配置选项

### 会话超时时间

```typescript
// src/index.ts
setTimeout(async () => {
  await stack.stop();
  sessionMap.delete(sessionKey);
}, keepAliveMs);  // 默认 30 秒

// 或全局清理（5 分钟无活动）
setInterval(() => {
  for (const [key, stack] of sessionMap.entries()) {
    const status = stack.appLayer.getStatus();
    if (status && status.lastActivity && (now - status.lastActivity > 300000)) {
      stack.stop();
      sessionMap.delete(key);
    }
  }
}, 60000);
```

### TCP 层参数

```typescript
// src/modules/tcp-layer/tcp-layer.ts
const DEFAULT_CONFIG: TcpLayerConfig = {
  max_retransmit: 3,         // 最大重传次数
  initial_timeout_ms: 5000,  // 初始超时 (ms)
  timeout_multiplier: 2,     // 超时倍增
  max_rounds: 15,            // 最大会话轮次
  window_size: 1,            // 窗口大小
};
```

## 📝 使用示例

### Agent 发送消息

```typescript
// OpenClaw Core 自动调用
await plugin.outbound.sendText({
  text: '你好',
  to: 'device-b',
  SessionKey: 'session-abc123',  // OpenClaw 自动维护
  accountId: 'default',
  cfg: {...},
});
```

### 接收消息

```typescript
// agent 收到消息
{
  text: '你好',
  metadata: {
    tcp: {
      connection_id: 'tcp-session-abc123',
      seq: 1,
      ack: 2,
      flags: ['DATA', 'ACK'],
    },
    appMessage: {
      type: 'message',
      data: { text: '你好' },
    },
  },
  SessionKey: 'session-abc123',  // 保持相同会话
}
```

## 🎯 特性

### ✅ 已实现
- TCP 可靠传输（seq/ack、重传）
- 会话管理（sessionMap）
- 多轮对话支持（SessionKey 保持）
- 自动清理超时会话
- 向后兼容（普通消息继续工作）

### ⏳ 待实现
- 流量控制（zero window）
- 选择性确认（SACK）
- 连接持久化
- 监控和日志增强

## 🐛 故障排除

### 问题 1: 连接未建立

**症状**: `Error: 连接未建立：当前状态=SYN_SENT`

**原因**: 接收方未响应 SYN

**解决**:
1. 检查 Redis 连接
2. 确认订阅频道正确
3. 确保先启动接收方

### 问题 2: 会话未复用

**症状**: 每次发送都创建新会话

**原因**: SessionKey 不一致

**解决**:
1. 检查 `ctx.SessionKey` 是否正确传递
2. 确认 `message-dispatcher.ts` 提取 SessionKey 逻辑
3. 验证 sessionMap 的 key 是否一致

### 问题 3: Redis 连接失败

**症状**: `ECONNREFUSED` 或 `NOAUTH`

**解决**:
```bash
# 检查 SSH 隧道
ps aux | grep ssh

# 检查 Redis 密码
echo $REDIS_PASSWORD

# 测试连接
node test-redis-connection.js
```

---

**版本**: 3.0.3  
**日期**: 2026-03-11  
**状态**: ✅ 集成完成
