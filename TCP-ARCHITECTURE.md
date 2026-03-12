# Redis Channel 三层架构重构

## 📐 架构设计

```
┌─────────────────────────────────────────────────┐
│  应用层 (Application Layer)                     │
│  - channelRuntime                               │
│  - agent / webchat                              │
│  - 处理业务逻辑                                 │
├─────────────────────────────────────────────────┤
│  传输层 (Transport Layer) ← 新增                │
│  - tcp-transport.ts                             │
│  - seq/ack、重传、流量控制                       │
│  - 类似 TCP 协议                                 │
├─────────────────────────────────────────────────┤
│  IP 层 (Network Layer)                          │
│  - redis-channel (原生)                          │
│  - Redis Pub/Sub                                │
│  - 只管收发，不保证可靠                          │
└─────────────────────────────────────────────────┘
```

## 🔄 消息流程

### 发送流程（Outbound）

```
Agent/Webchat
    ↓
sendOutboundMessage (应用层)
    ↓
sendViaTcpTransport (传输层) ← 新增 TCP 封装
    ↓
sendTcpSegment (IP 层)
    ↓
Redis Publish
```

### 接收流程（Inbound）

```
Redis Subscribe
    ↓
handleInboundMessage (IP 层)
    ↓
检测 _tcp 字段
    ↓
┌───────────────────┬───────────────────┐
│   是 TCP Segment   │   普通消息        │
│        ↓          │        ↓          │
│ handleTcpSegment  │  原有逻辑处理      │
│ (传输层)          │                   │
│        ↓          │                   │
│   TcpTransport   │                   │
│        ↓          │                   │
│   应用层回调      │                   │
└───────────────────┴───────────────────┘
```

## 📦 新增文件

### `src/lib/tcp-types.ts`
TCP 传输层类型定义：
- `TcpFlags` - 标志位 (SYN, ACK, FIN, DATA)
- `TcpState` - 连接状态
- `TcpSegment` - TCP 消息结构
- `TcpConnection` - 连接上下文
- `TransportConfig` - 传输层配置

### `src/lib/tcp-transport.ts`
TCP 传输层实现：
- `TcpTransportLayer` 类
- 连接管理（握手、数据传输、断开）
- seq/ack 机制
- 超时重传
- 流量控制（窗口=1）

### `src/lib/message-handler.ts` (修改)
- 新增 `handleTcpSegment()` 函数
- 修改 `handleInboundMessage()` 检测 TCP Segment

### `src/lib/message-sender.ts` (修改)
- 新增 `sendTcpSegment()` 函数
- 新增 `sendViaTcpTransport()` 函数

## 🔧 消息格式

### 普通消息（IP 层）
```json
{
  "senderId": "device-a",
  "senderName": "Device A",
  "text": "Hello",
  "timestamp": 1710156000
}
```

### TCP Segment（传输层）
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
    { "type": "task", "data": {...} }
  ]
}
```

## 🚀 使用方式

### 方式 1：普通消息（原有方式，不保证可靠）

```typescript
import { sendOutboundMessage } from './lib/message-sender';

await sendOutboundMessage(
  'Hello World',
  { id: 'target-device' },
  account
);
```

### 方式 2：TCP 可靠传输（新增）

```typescript
import { createTcpTransport } from './lib/tcp-transport';

// 创建传输层实例
const transport = createTcpTransport(
  'device-a',           // 本地 deviceId
  'device-b',           // 目标 deviceId
  'session-001',        // 连接 ID
  ipSend,               // IP 层发送函数
  ipSubscribe,          // IP 层订阅函数
  ipUnsubscribe,        // IP 层取消订阅函数
  logger
);

// 注册回调
transport.onData((data) => {
  console.log('收到数据:', data);
});

transport.onConnected(() => {
  console.log('连接已建立');
});

// 启动
await transport.start();

// 发起连接
await transport.connect({ type: 'greeting', message: 'Hello!' });

// 发送数据
await transport.send({ type: 'task', content: 'Process this' });

// 关闭连接
await transport.close();
```

## ⚙️ 配置选项

```typescript
const config = {
  max_retransmit: 3,         // 最大重传次数
  initial_timeout_ms: 5000,  // 初始超时 (ms)
  timeout_multiplier: 2,     // 超时倍增系数
  max_rounds: 15,            // 最大会话轮次
  window_size: 1,            // 窗口大小
};
```

## 🎯 兼容性

- **向后兼容**: 原有 `sendOutboundMessage` 继续工作
- **渐进增强**: 需要可靠传输时使用 TCP 层
- **自动检测**: 收到消息自动识别是否为 TCP Segment

## 📊 状态机

```
CLOSED → SYN_SENT → ESTABLISHED → FIN_WAIT → CLOSED
          ↓              ↓
     SYN_RCVD      CLOSE_WAIT
```

## 🔍 调试

启用 debug 日志：
```bash
DEBUG=redis-channel node ...
```

日志输出：
```
[TCP-Transport] 初始化：device-a -> device-b, connection=session-001
[TCP-Transport] 已启动
[TCP-Transport] 已发送 SYN
[TCP-Transport] 收到：flags=[SYN,ACK] seq=100
[TCP-Transport] 连接已建立
[TCP-Transport] 收到：flags=[DATA,ACK] seq=101
```

---

**版本**: 1.0.0  
**作者**: GWork  
**日期**: 2026-03-11
