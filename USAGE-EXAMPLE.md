# Redis Channel 使用示例

## 📐 架构图

```
发送方：
webchat/agent → AppLayer → TCPLayer → IPLayer → Redis Publish

接收方：
Redis Subscribe → IPLayer → TCPLayer → AppLayer → agent
```

## 🚀 快速开始

### 方式 1：完整栈（推荐）

```typescript
import { createRedisChannelStack } from './modules';

// ========== 发送方 (Device A) ==========
const stackA = createRedisChannelStack({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
  targetDeviceId: 'device-b',
  connectionId: 'session-001',
  isInitiator: true,  // 发起方
  initialMessage: {
    type: 'greeting',
    data: { message: 'Hello from A!' },
    timestamp: Date.now(),
  },
});

await stackA.start();

// 发送消息
await stackA.appLayer.sendMessage({
  type: 'message',
  data: { text: 'How are you?' },
  timestamp: Date.now(),
});

// 接收消息
stackA.appLayer.onMessage((data) => {
  console.log('A 收到:', data);
});

// ========== 接收方 (Device B) ==========
const stackB = createRedisChannelStack({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-b',
  targetDeviceId: 'device-a',
  connectionId: 'session-001',
  isInitiator: false,  // 接收方
});

await stackB.start();

// 接收消息
stackB.appLayer.onMessage((data) => {
  console.log('B 收到:', data);
  
  // 回复
  stackB.appLayer.sendMessage({
    type: 'message',
    data: { text: 'I am fine!' },
    timestamp: Date.now(),
  });
});
```

### 方式 2：分层使用

```typescript
import { createIPLayer } from './modules/ip-layer';
import { createTCPLayer } from './modules/tcp-layer';
import { createAppLayer } from './modules/app-layer';

// 1. 创建 IP 层
const ipLayer = createIPLayer({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
});

// 2. 创建 TCP 层
const tcpLayer = createTCPLayer(
  'device-a',
  'device-b',
  'session-001',
  ipLayer
);

// 3. 创建应用层
const appLayer = createAppLayer(tcpLayer, true, {
  type: 'greeting',
  data: { message: 'Hello!' },
  timestamp: Date.now(),
});

// 4. 启动
await ipLayer.initialize();
await appLayer.start();

// 5. 使用
appLayer.onMessage((data) => console.log(data));
await appLayer.sendMessage({ type: 'message', data: {}, timestamp: Date.now() });
```

### 方式 3：仅 IP 层（原有方式）

```typescript
import { createIPLayer } from './modules/ip-layer';

const ipLayer = createIPLayer({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
});

// 发送普通消息（不经过 TCP）
await ipLayer.send('device-b', {
  senderId: 'device-a',
  text: 'Hello',
  timestamp: Date.now(),
});

// 接收消息
ipLayer.onReceive('device-a', (message) => {
  console.log('收到:', message);
});
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

### IP 层消息（Redis Pub/Sub）
```json
{
  "senderId": "device-a",
  "text": "{\"_tcp\":{...},\"payload\":[...]}",
  "timestamp": 1710156000,
  "metadata": {
    "isTcpSegment": true,
    "segment": {...}
  }
}
```

## 🔧 配置选项

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

## 🎯 与 agent 集成

```typescript
// 在 agent 中使用
const stack = createRedisChannelStack({...});
await stack.start();

// agent 发送消息
async function agentSend(text: string) {
  await stack.appLayer.sendMessage({
    type: 'agent_response',
    data: { text },
    timestamp: Date.now(),
  });
}

// agent 接收消息
stack.appLayer.onMessage((data) => {
  if (data.type === 'user_message') {
    // 处理用户消息
    const response = processMessage(data.data.text);
    agentSend(response);
  }
});
```

---

**版本**: 3.0.0  
**日期**: 2026-03-11
