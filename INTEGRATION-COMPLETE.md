# Redis Channel 集成完成

## ✅ 已完成的工作

### 1. 三层架构模块
```
src/modules/
├── ip-layer/          # IP 层（Redis Pub/Sub）
│   ├── types.ts
│   └── ip-layer.ts
│
├── tcp-layer/         # TCP 层（传输层）
│   ├── types.ts
│   └── tcp-layer.ts
│
├── app-layer/         # 应用层（业务逻辑）
│   └── app-layer.ts
│
└── index.ts           # 统一导出
```

### 2. 集成到现有插件

#### `src/index.ts` 修改
- 导入新模块：`import { createRedisChannelStack, AppMessage } from './modules'`
- 修改 `sendText`：支持 TCP 传输（通过 `metadata.useTcp` 控制）

#### `src/lib/message-handler.ts` 修改
- 简化 `handleTcpSegment`：直接处理 TCP Segment，提取应用层数据
- 保持异步处理

### 3. 使用方式

#### 方式 1：普通消息（原有方式）
```typescript
await sendOutboundMessage('Hello', { id: 'device-b' }, account);
```

#### 方式 2：TCP 可靠传输
```typescript
// 通过 metadata 控制
const ctx = {
  text: 'Hello',
  to: 'device-b',
  metadata: {
    useTcp: true,
    connectionId: 'session-001',
  },
};

await sendText(ctx);
```

#### 方式 3：直接使用新模块
```typescript
import { createRedisChannelStack } from './modules';

const stack = createRedisChannelStack({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
  targetDeviceId: 'device-b',
  connectionId: 'session-001',
  isInitiator: true,
  initialMessage: {
    type: 'greeting',
    data: { message: 'Hello!' },
    timestamp: Date.now(),
  },
});

await stack.start();
await stack.appLayer.sendMessage({
  type: 'message',
  data: { text: 'How are you?' },
  timestamp: Date.now(),
});
```

## 🔄 数据流

### 发送（Outbound）
```
webchat/agent
    ↓
sendText() [index.ts]
    ↓
检查 metadata.useTcp
    ├─ false → sendOutboundMessage() [原有流程]
    └─ true  → createRedisChannelStack() → AppLayer → TCPLayer → IPLayer → Redis Publish
```

### 接收（Inbound）
```
Redis Subscribe
    ↓
handleInboundMessage()
    ↓
检测 _tcp 字段
    ├─ 有 → handleTcpSegment() → 提取应用层数据 → emitMessage() → agent
    └─ 无 → 原有流程 → handleInboundMessageDispatch() → agent
```

## 📊 消息格式

### 应用层消息
```json
{
  "type": "message",
  "data": {
    "text": "Hello",
    "timestamp": 1710156000
  }
}
```

### TCP Segment
```json
{
  "_tcp": {
    "connection_id": "session-001",
    "seq": 1,
    "ack": 2,
    "flags": ["DATA", "ACK"],
    "timestamp": 1710156000
  },
  "payload": [
    {
      "type": "message",
      "data": { "text": "Hello" }
    }
  ]
}
```

## 🎯 配置选项

### 启用 TCP 传输
在 `openclaw.plugin.json` 或消息 context 中添加：

```json
{
  "metadata": {
    "useTcp": true,
    "connectionId": "session-001"
  }
}
```

### TCP 层配置
```typescript
{
  max_retransmit: 3,         // 最大重传次数
  initial_timeout_ms: 5000,  // 初始超时 (ms)
  timeout_multiplier: 2,     // 超时倍增
  max_rounds: 15,            // 最大会话轮次
  window_size: 1,            // 窗口大小
}
```

## 📝 注意事项

1. **向后兼容**: 原有 `sendOutboundMessage` 继续工作
2. **渐进增强**: 需要可靠传输时使用 TCP 模式
3. **自动检测**: 收到消息自动识别是否为 TCP Segment
4. **资源管理**: TCP 连接会在 5 秒后自动关闭（可调整）

## 🚀 下一步

1. **测试**: 在实际场景中测试 TCP 连接和数据传输
2. **优化**: 根据反馈调整超时、重传等参数
3. **文档**: 完善 API 文档和使用示例
4. **监控**: 添加连接状态监控和日志

---

**版本**: 3.0.0  
**日期**: 2026-03-11  
**状态**: ✅ 集成完成
