# Redis TCP Channel - 可靠传输模式

**版本**: 1.0.0  
**更新日期**: 2026-03-12  
**状态**: ✅ 测试完成

---

## 🎯 特性

- ✅ **TCP 可靠传输**: seq/ack 序号管理、超时重传
- ✅ **会话管理**: 自动创建/复用/清理 TCP 会话
- ✅ **三层架构**: Physical → IP → TCP → Application
- ✅ **OpenClaw 集成**: 通过 `sendText()` 调用
- ✅ **双向通信**: 支持请求 - 回复模式

---

## 🏗️ 架构设计

### 三层架构

```
┌─────────────────────────────────────┐
│     Application Layer (应用层)       │
│  - onMessage() 消息回调              │
│  - sendMessage() 发送消息            │
│  - SessionService 会话管理           │
└──────────────┬──────────────────────┘
               │ AppMessage
┌──────────────▼──────────────────────┐
│       TCP Layer (传输层)            │
│  - seq/ack 序号管理                  │
│  - 超时重传 (max 3 次)               │
│  - 连接状态机 (SYN/ESTABLISHED/FIN)  │
└──────────────┬──────────────────────┘
               │ TcpSegment
┌──────────────▼──────────────────────┐
│        IP Layer (网络层)            │
│  - Redis Pub/Sub 订阅/发布           │
│  - 装包 (Segment → JSON)            │
│  - 拆包 (JSON → Segment)            │
└──────────────┬──────────────────────┘
               │ Redis Message
┌──────────────▼──────────────────────┐
│    Physical Layer (物理连接)        │
│  - Redis Client (redis npm)         │
└─────────────────────────────────────┘
```

### TCP 握手流程

```
Sender (Initiator)                    Receiver
     │                                   │
     │─── SYN (payload: initialData) ───>│  1. 发送 SYN（包含第一条消息）
     │                                   │  2. 提取 payload，回调 onMessage()
     │<── SYN+ACK ───────────────────────│  3. 回复 SYN+ACK
     │─── ACK ──────────────────────────>│  4. 确认连接
     │                                   │  5. 连接建立 (ESTABLISHED)
     │                                   │
     │─── DATA (seq=2) ─────────────────>│  6. 发送数据
     │<── ACK (ack=3) ───────────────────│  7. 确认收到
     │                                   │
```

---

## 🧪 测试

### 快速测试

```bash
# 1. Redis 连接测试
node test-redis-connection.js

# 2. TCP Stack 测试（双终端）
# 终端 1 (Receiver):
node test-tcp-stack.js --device-id=tcp-test-a --target=tcp-test-b --role=receiver

# 终端 2 (Sender):
node test-tcp-stack.js --device-id=tcp-test-b --target=tcp-test-a --role=initiator

# 3. 完整集成测试（双向）
node test-full-integration.js

# 4. session-send 模拟测试
node test-session-send-full.js
```

### 测试结果

查看 **[TEST-RESULTS.md](./TEST-RESULTS.md)** 获取完整测试报告。

**总结**: 所有测试 ✅ 通过

| 测试项 | 状态 |
|--------|------|
| Redis 连接 | ✅ |
| TCP 握手 | ✅ |
| 消息发送/接收 | ✅ |
| 会话复用 | ✅ |
| OpenClaw 集成 | ✅ |

---

## 📤 使用方式

### 方式 1: 通过 SessionService

```typescript
import { getSessionService } from './dist/business/session-service';

const sessionService = getSessionService();

const account = {
  enabled: true,
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
  deviceName: 'Device A',
};

// 发送消息（自动创建/复用会话）
const result = await sessionService.sendMessage(
  account,
  'device-b',           // 目标设备
  'session-key-001',    // 会话 Key（用于复用）
  'Hello TCP Channel!'  // 消息内容
);

console.log(result); // { ok: true, id: 'tcp-session-key-001' }
```

### 方式 2: 直接使用 Stack

```typescript
import { createRedisChannelStack } from './dist/modules';

const stack = createRedisChannelStack({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
  targetDeviceId: 'device-b',
  connectionId: 'my-session-001',
  isInitiator: true,
  initialMessage: {
    type: 'greeting',
    data: { message: 'Hello!' },
    timestamp: Date.now(),
  },
});

// 注册消息回调
stack.onMessage((msg) => {
  console.log('收到消息:', msg.data);
});

// 启动
await stack.start();

// 发送消息
await stack.sendMessage({
  type: 'message',
  data: { text: 'How are you?' },
  timestamp: Date.now(),
});

// 停止
await stack.stop();
```

### 方式 3: 通过 OpenClaw sendText

```typescript
import { redisChannelPlugin } from './dist/index';

const ctx = {
  text: 'Hello from OpenClaw!',
  to: 'device-b',
  accountId: 'default',
  cfg: {
    channels: {
      'redis-channel': {
        accounts: {
          default: {
            enabled: true,
            redisUrl: 'redis://localhost:6379',
            deviceId: 'device-a',
          }
        }
      }
    }
  },
  SessionKey: 'session-001',
};

const result = await redisChannelPlugin.outbound.sendText(ctx);
console.log(result); // { ok: true, id: 'tcp-session-001', ... }
```

---

## 📊 会话管理

### 会话复用

相同 `SessionKey` 的消息会复用同一个 TCP 连接：

```typescript
// 第 1 条消息 - 创建新会话
await sessionService.sendMessage(account, 'device-b', 'session-001', 'Message 1');
// → 创建 TCP 连接，发送消息

// 第 2 条消息 - 复用会话
await sessionService.sendMessage(account, 'device-b', 'session-001', 'Message 2');
// → 使用已有 TCP 连接，直接发送

// 第 3 条消息 - 复用会话
await sessionService.sendMessage(account, 'device-b', 'session-001', 'Message 3');
// → 继续使用已有连接
```

### 会话清理

- **自动清理**: 5 分钟无活动的会话自动关闭
- **手动清理**: 调用 `sessionService.closeSession(sessionKey)`
- **停止服务**: 调用 `sessionService.stop()` 关闭所有会话

---

## ⚙️ 配置选项

### TCP 层配置

```typescript
{
  max_retransmit: 3,         // 最大重传次数
  initial_timeout_ms: 5000,  // 初始超时 (ms)
  timeout_multiplier: 2,     // 超时倍增系数
  max_rounds: 15,            // 最大会话轮次
  window_size: 1,            // 窗口大小
}
```

### 消息格式

**应用层消息**:
```json
{
  "type": "message",
  "data": {
    "text": "Hello",
    "timestamp": 1710156000
  },
  "timestamp": 1710156000
}
```

**TCP Segment**:
```json
{
  "_tcp": {
    "connection_id": "session-001",
    "seq": 1,
    "ack": 2,
    "flags": ["SYN", "ACK"],
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

---

## 🐛 故障排除

### 问题 1: IP-Layer not connected

**原因**: IP 层未启动就调用发送方法  
**解决**: 确保先调用 `stack.start()` 或 `sessionService.sendMessage()`（会自动启动）

### 问题 2: 连接未建立 (CLOSED/SYN_SENT)

**原因**: initialMessage 为 undefined，TCP 握手未发起  
**解决**: 创建会话时传递第一条消息作为 initialMessage

### 问题 3: Receiver 未收到消息

**原因**: SYN 包中的 payload 未提取  
**解决**: 已修复（v1.0.0），升级最新版本

### 问题 4: Redis 连接失败

```bash
# 检查 Redis 是否运行
redis-cli ping

# 检查 SSH 隧道（如果 Redis 在远程）
ps aux | grep ssh

# 重启 SSH 隧道
ssh -N -f -L 16379:127.0.0.1:6379 user@remote-host
```

---

## 📚 相关文档

- [TEST-RESULTS.md](./TEST-RESULTS.md) - 测试结果报告
- [TEST-GUIDE.md](./TEST-GUIDE.md) - 测试指南
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构说明
- [SESSION-MANAGEMENT.md](./SESSION-MANAGEMENT.md) - 会话管理

---

**版本**: 1.0.0  
**日期**: 2026-03-12  
**状态**: ✅ 生产就绪
