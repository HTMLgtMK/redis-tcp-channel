# Redis TCP Channel - 最终架构文档

**版本**: 2.0.0  
**日期**: 2026-03-12  
**状态**: ✅ 测试通过

---

## 🏗️ 架构设计

### 四层架构

```
┌─────────────────────────────────────┐
│   Physical Layer (ioredis)          │
│   - Redis 长连接                     │
│   - 订阅/发布                        │
└──────────────┬──────────────────────┘
               │ raw JSON
               ▼
┌─────────────────────────────────────┐
│   IP Layer                          │
│   - 解封装：JSON → TcpSegment        │
│   - 装包：TcpSegment → JSON          │
└──────────────┬──────────────────────┘
               │ TcpSegment
               ▼
┌─────────────────────────────────────┐
│   TCP Layer                         │
│   - seq/ack 序号管理                 │
│   - 连接状态机                       │
│   - 超时重传                         │
└──────────────┬──────────────────────┘
               │ AppMessage
               ▼
┌─────────────────────────────────────┐
│   Application Layer                 │
│   - onMessage 回调                   │
│   - sendMessage 接口                 │
└─────────────────────────────────────┘
```

### 连接池设计

```
TcpConnectionPool (全局单例)
    ↓ Map<connectionId, TCPLayer>
TCPLayer[]  ← 直接管理，无包装层
```

---

## ✅ 测试验证

### 通过的测试

| 测试 | 状态 | 说明 |
|------|------|------|
| PhysicalLayer | ✅ | Redis 连接/订阅/发布 |
| TCP Stack (双终端) | ✅ | TCP 握手/消息收发 |
| 完整集成测试 | ✅ | 双向通信 (4 条消息) |
| 回复流程测试 | ✅ | Agent 收到并回复 |

### 测试结果

```
✅ Receiver 收到 4 条消息
✅ Sender 收到 4 条回复
✅ TCP 握手完成 (SYN → SYN+ACK → ACK)
✅ 连接池正常工作
✅ 超时清理机制就绪
```

---

## 🚀 使用方式

### 1. Receiver (监听方)

```typescript
import { createPhysicalLayer } from './dist/modules/physical-layer';
import { createInboundStack } from './dist/modules/inbound-stack';

const physicalLayer = createPhysicalLayer({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'receiver-device',
});

const inboundStack = createInboundStack('receiver-device', 'inbound-receiver');
inboundStack.setPhysicalLayer(physicalLayer);

inboundStack.onMessage(async (msg) => {
  console.log('收到:', msg.data.text);
  
  // 回复
  await inboundStack.sendMessage({
    type: 'response',
    data: { text: '收到！' },
    timestamp: Date.now(),
    _connectionId: msg._connectionId,  // ← 关键！
  });
});

await physicalLayer.start({ onMessage: () => {}, onDisconnect: () => {} });
await inboundStack.start();
```

### 2. Sender (发送方)

```typescript
import { createPhysicalLayer } from './dist/modules/physical-layer';
import { createRedisChannelStack } from './dist/modules';

const physicalLayer = createPhysicalLayer({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'sender-device',
});

const stack = createRedisChannelStack({
  deviceId: 'sender-device',
  targetDeviceId: 'receiver-device',
  connectionId: 'my-session-001',
  isInitiator: true,
  initialMessage: {
    type: 'greeting',
    data: { text: 'Hello!' },
    timestamp: Date.now(),
  },
});

stack.setPhysicalLayer(physicalLayer);

stack.onMessage((msg) => {
  console.log('收到回复:', msg.data.text);
});

await physicalLayer.start({ onMessage: () => {}, onDisconnect: () => {} });
await stack.start();

// 发送更多消息
await stack.sendMessage({
  type: 'message',
  data: { text: 'How are you?' },
  timestamp: Date.now(),
});
```

---

## 📊 TCP 握手流程

```
Sender                          Receiver
   │─── SYN (seq=1) ───────────>│
   │<── SYN+ACK (seq=X, ack=2) ─│
   │─── ACK (seq=2, ack=X+1) ──>│
   │─── DATA (seq=2) ──────────>│  ← initialMessage
   │<── ACK (seq=X+1, ack=3) ───│
   │<── DATA (seq=X+1) ─────────│  ← 回复
   │─── ACK (seq=3, ack=X+2) ──>│
```

---

## 🔧 配置示例

### openclaw.json

```json
{
  "plugins": {
    "installs": {
      "redis-tcp-channel": {
        "source": "path",
        "installPath": "/path/to/redis-tcp-channel"
      }
    }
  },
  "channels": {
    "redis-tcp-channel": {
      "enabled": true,
      "accounts": {
        "default": {
          "redisUrl": "redis://localhost:6379",
          "deviceId": "my-device",
          "targetSession": "agent:main:main"
        }
      }
    }
  }
}
```

---

## 📝 关键设计决策

### 1. 删除 TcpConnection 包装层

**原因**：
- 状态不同步 (`TcpConnection.state` vs `TCPLayer.connection.state`)
- 多余的包装层增加复杂度

**解决**：连接池直接管理 `TCPLayer`

### 2. ioredis 替代 redis

**原因**：
- 更成熟稳定
- 更好的集群支持
- 原生 Promise 支持

### 3. SYN 不携带数据

**原因**：
- 符合标准 TCP 语义
- 避免状态同步问题

**流程**：握手完成后再发送 initialData

---

## 🧪 测试命令

```bash
# PhysicalLayer 测试
node test-physical-layer.js

# TCP Stack 双终端测试
# 终端 1:
node test-tcp-stack.js --role=receiver
# 终端 2:
node test-tcp-stack.js --role=initiator

# 完整集成测试
node test-full-integration.js

# 回复流程测试
node test-reply-flow.js
```

---

**版本**: 2.0.0  
**日期**: 2026-03-12  
**状态**: ✅ 生产就绪
