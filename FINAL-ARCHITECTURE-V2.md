# 最终架构 V2 - IP 层直连 TCP 层

## 📐 架构设计

### 核心原则

**IP 层的 `onMessage` 直接暴露给 TCP 层，不需要插件层中转**

```
IP Layer.start({ onMessage, onDisconnect })
    ↓ 直接传递
TCP Layer.getIpLayerCallbacks()
    ↓ 处理 seq/ack
AppLayer.onData()
    ↓ 业务逻辑
Business Layer
```

### 四层架构

```
┌─────────────────────────────────────────────────┐
│  Plugin Layer (插件层)                          │
│  src/index.ts                                   │
│  - OpenClaw 插件接口                             │
│  - 启动 Gateway                                  │
│  - 处理普通消息（非 TCP）                        │
├─────────────────────────────────────────────────┤
│  Business Layer (业务逻辑层)                    │
│  src/business/session-service.ts                │
│  - 会话管理 (sessionMap)                        │
│  - 发送消息                                      │
├─────────────────────────────────────────────────┤
│  App/TCP/IP Layers (模块层)                     │
│  src/modules/                                   │
│  - AppLayer: 应用层接口                          │
│  - TCPLayer: 传输层 (seq/ack)                   │
│  - IPLayer: 网络层 (Redis, 装包/拆包)            │
└─────────────────────────────────────────────────┘
```

## 🔄 数据流

### 启动流程

```typescript
// src/modules/index.ts
class RedisChannelStack {
  async start(): Promise<void> {
    // 1. 启动 TCP 层（注册回调）
    await this.tcpLayer.start();
    
    // 2. 启动 IP 层，使用 TCP 层提供的回调
    await this.ipLayer.start(this.tcpLayer.getIpLayerCallbacks());
    
    // 3. 启动应用层
    await this.appLayer.start();
  }
}

// TCP 层提供回调
class TcpLayerImpl {
  getIpLayerCallbacks() {
    return {
      onMessage: (segment: TcpSegment) => {
        this._handleIncoming(segment);  // 处理 seq/ack
      },
      onDisconnect: () => {
        this.connection.state = TcpState.CLOSED;
      },
    };
  }
}
```

### 接收流程

```
Redis Pub/Sub
    ↓
IP Layer.start({ onMessage, ... })
    ↓ 订阅频道
    ↓ 收到消息 → 拆包
    ↓ callbacks.onMessage(segment)
    ↓
TCP Layer._handleIncoming(segment)
    ↓ 验证 seq/ack
    ↓ 状态转换
    ↓
AppLayer.onData(appMessage)
    ↓
Business Layer (可选)
    ↓
Agent (通过插件层 emitMessage)
```

### 发送流程

```
webchat/agent
    ↓
Plugin Layer.sendText()
    ↓
Business Layer.sendMessage()
    ↓
AppLayer.sendMessage()
    ↓
TCP Layer.send()
    ↓ seq/ack 封装
    ↓
IP Layer.send()
    ↓ 装包
    ↓
Redis Publish
```

## 📁 关键代码

### 1. IP 层接口

```typescript
// src/modules/ip-layer/ip-layer.ts
interface IPLayer {
  start(callbacks: {
    onMessage: (segment: TcpSegment) => void;
    onDisconnect?: () => void;
  }): Promise<void>;
  
  send(targetDeviceId: string, segment: TcpSegment): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
}
```

### 2. TCP 层接口

```typescript
// src/modules/tcp-layer/types.ts
interface TCPLayer {
  start(): Promise<void>;
  send(data: AppMessage): Promise<void>;
  onData(callback: (data: AppMessage) => void): void;
  connect(initialData?: AppMessage): Promise<void>;
  close(): Promise<void>;
  getStatus(): any;
  
  // 新增：提供 IP 层回调
  getIpLayerCallbacks(): {
    onMessage: (segment: TcpSegment) => void;
    onDisconnect?: () => void;
  };
}
```

### 3. 模块层启动

```typescript
// src/modules/index.ts
class RedisChannelStack {
  async start(): Promise<void> {
    // 1. TCP 层启动，准备回调
    await this.tcpLayer.start();
    
    // 2. IP 层启动，使用 TCP 层的回调
    await this.ipLayer.start(this.tcpLayer.getIpLayerCallbacks());
    
    // 3. 应用层启动
    await this.appLayer.start();
  }
}
```

### 4. 插件层

```typescript
// src/index.ts
gateway: {
  startAccount: async (params) => {
    // 启动 Redis 订阅（处理普通消息）
    await subscriber.subscribe(subscribeChannel, async (message) => {
      // 检测是否是 TCP 消息
      const parsed = JSON.parse(message);
      if (parsed._tcp && parsed._tcp.connection_id) {
        // TCP 消息，由模块层 IP 层处理，这里忽略
        return;
      }
      
      // 普通消息，原有流程
      await handleInboundMessage(message, redisConfig, handlerDeps);
    });
  }
}
```

## 🎯 优势

### 1. 分层清晰

| 层 | 职责 | 依赖 |
|------|------|------|
| **Plugin** | OpenClaw 接口、普通消息 | Business |
| **Business** | 会话管理 | Modules |
| **App/TCP/IP** | 模块内部闭环 | 无 |

### 2. 模块独立

- ✅ 模块层（App/TCP/IP）可以独立测试
- ✅ 不依赖插件层
- ✅ 可以在其他地方复用

### 3. 消息处理高效

```
之前：
Redis → Plugin → TCP → App → Business
       ↑                        ↓
       └────────────────────────┘
       (回调中转，效率低)

现在：
Redis → IP → TCP → App → Business
       ↑              ↓
       └──────────────┘
       (直接回调，效率高)
```

### 4. 断联处理

```typescript
// IP 层检测到断联
this.subscriber.on('error', (err) => {
  this.connected = false;
  
  // 直接调用 TCP 层的 onDisconnect
  if (this.callbacks?.onDisconnect) {
    this.callbacks.onDisconnect();
  }
});

// TCP 层清理状态
getIpLayerCallbacks() {
  return {
    onDisconnect: () => {
      this.connection.state = TcpState.CLOSED;
    },
  };
}
```

## 📊 对比

### 之前（插件层中转）

```typescript
// ❌ 插件层中转
await ipLayer.start({
  onMessage: (segment) => {
    handleInboundMessage(segment);  // 插件层处理
    // ↓
    // tcpLayer.handleIncomingMessage(segment);
  }
});
```

### 现在（直接回调）

```typescript
// ✅ 直接回调
await ipLayer.start(tcpLayer.getIpLayerCallbacks());
// IP → TCP 直接传递
```

## 🧪 测试

### 模块层独立测试

```typescript
// test-modules.test.ts
describe('Modules', () => {
  it('should handle message end-to-end', async () => {
    const stack = createRedisChannelStack(config);
    
    // 启动模块层
    await stack.start();
    
    // 模拟收到消息
    const testSegment: TcpSegment = {
      _tcp: { connection_id: 'test', seq: 1, ack: 0, flags: ['SYN'], timestamp: Date.now() },
      payload: [],
    };
    
    // IP 层会调用 TCP 层的回调
    // TCP 层处理 seq/ack
    // AppLayer 触发 onData
    
    await stack.stop();
  });
});
```

### 插件层测试

```typescript
// test-plugin.test.ts
describe('Plugin', () => {
  it('should handle non-TCP messages', async () => {
    // 插件层只处理普通消息
    // TCP 消息由模块层处理
  });
});
```

---

**版本**: 3.0.6  
**日期**: 2026-03-11  
**状态**: ✅ 架构完成
