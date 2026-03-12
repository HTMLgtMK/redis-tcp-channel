# 完整架构 - 接收数据流

## 📐 正确的接收数据流

```
Redis Pub/Sub
    ↓ 原始消息
IP Layer (src/modules/ip-layer/)
    ↓ 拆包 (Redis Message → TcpSegment)
    ↓ onMessage(segment)
TCP Layer (src/modules/tcp-layer/)
    ↓ 处理 seq/ack、状态转换
    ↓ onData(appMessage)
App Layer (src/modules/app-layer/)
    ↓ 业务消息格式
    ↓ onMessage(appMessage)
Plugin Layer (src/index.ts)
    ↓ emitMessage(normalizedMessage)
Agent
```

## 🔄 回调链

```typescript
// 1. Plugin 层创建回调
const onMessage = (appMessage: AppMessage) => {
  // 转换为 NormalizedMessage
  const msg = {
    text: appMessage.data.text,
    metadata: { appMessage },
  };
  emitMessage(msg);  // 传递给 agent
};

// 2. 创建 Stack 并注册回调
const stack = createRedisChannelStack(config);
stack.onMessage(onMessage);  // Plugin → App
await stack.start();

// 3. Stack 内部回调链
// AppLayer → TCP Layer
tcpLayer.setOnDataCallback((data) => {
  appLayer.onMessage(data);  // App 层回调
});

// TCP Layer → IP Layer
await ipLayer.start(tcpLayer.getIpLayerCallbacks());

// 4. 接收消息时
// IP → TCP → App → Plugin
```

## 📁 各层职责

### IP Layer

**文件**: `src/modules/ip-layer/ip-layer.ts`

**职责**:
- ✅ 创建 Redis 订阅者
- ✅ 订阅频道
- ✅ 拆包（Redis Message → TcpSegment）
- ✅ 调用 `callbacks.onMessage(segment)`

**代码**:
```typescript
async start(callbacks: { onMessage, onDisconnect }): Promise<void> {
  this.subscriber = await createSubscriber(account);
  
  await this.subscriber.subscribe(channel, (rawMessage) => {
    const parsed = JSON.parse(rawMessage);
    
    // 拆包：检测 TCP Segment
    if (parsed._tcp && parsed._tcp.connection_id) {
      callbacks.onMessage(parsed as TcpSegment);  // ← 调用 TCP 层回调
    }
  });
}
```

### TCP Layer

**文件**: `src/modules/tcp-layer/tcp-layer.ts`

**职责**:
- ✅ 提供 `getIpLayerCallbacks()` 给 IP 层
- ✅ 处理 `onMessage(segment)` - 验证 seq/ack、状态转换
- ✅ 调用 `onDataCallback(appMessage)` 传递给 App 层

**代码**:
```typescript
getIpLayerCallbacks() {
  return {
    onMessage: (segment: TcpSegment) => {
      this._handleIncoming(segment);  // 处理 seq/ack
    },
  };
}

_handleIncoming(segment: TcpSegment) {
  // 验证 seq/ack
  if (seq === this.connection.expected_seq) {
    this.connection.expected_seq = seq + 1;
    
    // 提取应用层数据
    if (segment.payload.length > 0) {
      this.onDataCallback(segment.payload[0]);  // ← 调用 App 层回调
    }
  }
}
```

### App Layer

**文件**: `src/modules/app-layer/app-layer.ts`

**职责**:
- ✅ 注册 TCP 层回调 `setOnDataCallback()`
- ✅ 调用 `onMessage(appMessage)` 传递给 Plugin 层

**代码**:
```typescript
async start() {
  // 注册 TCP 层回调
  this.tcpLayer.setOnDataCallback((data: AppMessage) => {
    if (this.messageCallback) {
      this.messageCallback(data);  // ← 调用 Plugin 层回调
    }
  });
  
  await this.tcpLayer.start();
}

onMessage(callback: (data: AppMessage) => void) {
  this.messageCallback = callback;  // Plugin 层注册的回调
}
```

### Plugin Layer

**文件**: `src/index.ts`

**职责**:
- ✅ 创建 RedisChannelStack
- ✅ 注册 `onMessage` 回调
- ✅ 转换为 NormalizedMessage 并传递给 agent

**代码**:
```typescript
// 创建 Stack
const stack = createRedisChannelStack({
  redisUrl: account.redisUrl,
  deviceId: account.deviceId,
  targetDeviceId: to,
  connectionId: `tcp-${sessionKey}`,
});

// 注册回调（接收消息）
stack.onMessage((appMessage: AppMessage) => {
  // 转换为 NormalizedMessage
  const normalizedMessage = {
    id: `tcp-${sessionKey}`,
    channel: 'redis-channel',
    senderId: 'tcp-peer',
    text: appMessage.data.text,
    metadata: { appMessage },
  };
  
  // 传递给 agent
  emitMessage(normalizedMessage);
});

// 启动
await stack.start();
```

## 📊 完整流程图

```
┌─────────────────────────────────────────────────┐
│  Redis Pub/Sub                                  │
│  openclaw:device:device-a                       │
└──────────────────┬──────────────────────────────┘
                   │ 原始消息
                   ▼
┌─────────────────────────────────────────────────┐
│  IP Layer (start)                               │
│  - 订阅频道                                      │
│  - 拆包：JSON → TcpSegment                      │
│  - callbacks.onMessage(segment)                 │
└──────────────────┬──────────────────────────────┘
                   │ TcpSegment
                   ▼
┌─────────────────────────────────────────────────┐
│  TCP Layer (getIpLayerCallbacks)                │
│  - 验证 seq/ack                                 │
│  - 状态转换                                      │
│  - onDataCallback(appMessage)                   │
└──────────────────┬──────────────────────────────┘
                   │ AppMessage
                   ▼
┌─────────────────────────────────────────────────┐
│  App Layer (onMessage)                          │
│  - 业务消息格式                                  │
│  - messageCallback(appMessage)                  │
└──────────────────┬──────────────────────────────┘
                   │ AppMessage
                   ▼
┌─────────────────────────────────────────────────┐
│  Plugin Layer (stack.onMessage)                 │
│  - 转换为 NormalizedMessage                     │
│  - emitMessage(normalizedMessage)               │
└──────────────────┬──────────────────────────────┘
                   │ NormalizedMessage
                   ▼
┌─────────────────────────────────────────────────┐
│  Agent (handleInboundMessageDispatch)           │
│  - 处理消息                                      │
│  - 回复                                          │
└─────────────────────────────────────────────────┘
```

## 🎯 关键代码位置

### 1. IP 层启动

```typescript
// src/modules/ip-layer/ip-layer.ts
async start(callbacks) {
  await this.subscriber.subscribe(channel, (rawMessage) => {
    const parsed = JSON.parse(rawMessage);
    if (parsed._tcp) {
      callbacks.onMessage(parsed);  // IP → TCP
    }
  });
}
```

### 2. TCP 层回调

```typescript
// src/modules/tcp-layer/tcp-layer.ts
getIpLayerCallbacks() {
  return {
    onMessage: (segment) => {
      this._handleIncoming(segment);
      // ↓ 提取 payload
      this.onDataCallback(segment.payload[0]);  // TCP → App
    },
  };
}
```

### 3. App 层回调

```typescript
// src/modules/app-layer/app-layer.ts
async start() {
  this.tcpLayer.setOnDataCallback((data) => {
    this.messageCallback(data);  // App → Plugin
  });
}

onMessage(callback) {
  this.messageCallback = callback;
}
```

### 4. Plugin 层注册

```typescript
// src/index.ts
const stack = createRedisChannelStack(config);

stack.onMessage((appMessage) => {
  const msg = {
    text: appMessage.data.text,
    metadata: { appMessage },
  };
  emitMessage(msg);  // → Agent
});

await stack.start();
```

## 🧪 测试

### 单元测试

```typescript
describe('Receive Flow', () => {
  it('should handle message end-to-end', async () => {
    // 创建 Stack
    const stack = createRedisChannelStack(config);
    
    // 注册回调
    const receivedMessages: AppMessage[] = [];
    stack.onMessage((msg) => receivedMessages.push(msg));
    
    // 启动
    await stack.start();
    
    // 模拟收到消息
    const testSegment: TcpSegment = {
      _tcp: { connection_id: 'test', seq: 1, ack: 0, flags: ['DATA'], timestamp: Date.now() },
      payload: [{ type: 'message', data: { text: '你好' } }],
    };
    
    // IP 层会调用 TCP 层回调
    // TCP 层处理后会调用 App 层回调
    // App 层回调会触发 Plugin 层回调
    
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].data.text).toBe('你好');
  });
});
```

---

**版本**: 3.0.7  
**日期**: 2026-03-11  
**状态**: ✅ 架构正确
