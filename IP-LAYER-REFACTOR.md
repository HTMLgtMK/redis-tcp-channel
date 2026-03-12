# IP 层重构 - 统一订阅管理

## 📐 问题

**之前**: 
- TCP 层自己调用 IP 层订阅
- 消息处理在模块外（message-handler.ts）
- 插件层和模块层职责不清

```typescript
// ❌ TCP 层自己订阅
await this.ipLayer.onReceive(deviceId, callback);

// ❌ 消息处理在模块外
handleInboundMessage() → handleTcpSegment()
```

## ✅ 重构后

### IP 层职责

```typescript
interface IPLayer {
  // 启动订阅（提供回调）
  start(callbacks: {
    onMessage: (segment: TcpSegment) => void;
    onDisconnect?: () => void;
  }): Promise<void>;
  
  // 发送消息
  send(targetDeviceId: string, segment: TcpSegment): Promise<void>;
  
  // 停止订阅
  stop(): Promise<void>;
  
  // 检查连接状态
  isConnected(): boolean;
}
```

### 数据流

```
插件层 (src/index.ts)
    ↓ startAccount()
    ↓
IP 层.start({ onMessage, onDisconnect })
    ↓ 创建 Redis 订阅者
    ↓ 订阅频道
    ↓
收到消息 → IP 层._handleMessage()
    ↓ 拆包（Redis Message → TcpSegment）
    ↓ callbacks.onMessage(segment)
    ↓
插件层处理 (handleInboundMessage)
    ↓ 检测 _tcp 字段
    ↓ handleTcpSegment()
    ↓ 提取应用层数据
    ↓ 传递给 agent
```

## 📁 修改的文件

### 1. `src/modules/ip-layer/ip-layer.ts`

**新增**:
- `IpLayerCallbacks` 接口
- `start(callbacks)` 方法
- `onDisconnect` 回调
- `isConnected()` 方法
- `_handleMessage()` 私有方法（拆包）

**删除**:
- `onReceive()` 方法（改为 start 时提供回调）
- `close()` 方法（改为 stop()）

### 2. `src/modules/tcp-layer/tcp-layer.ts`

**修改**:
- `start()` 不再调用 IP 层订阅
- 新增 `registerIpLayerCallback()`（由插件层调用）
- 新增 `handleIncomingMessage(segment)`（由插件层调用）

### 3. `src/index.ts` (插件层)

**修改**:
- `startAccount()` 启动 IP 层订阅
- 传递 `onMessage` 和 `onDisconnect` 回调
- 在 `onMessage` 中调用 `handleInboundMessage()`

## 🔄 完整流程

### 启动流程

```typescript
// src/index.ts
gateway: {
  startAccount: async (params) => {
    const { account: redisConfig } = params;
    
    // 1. 创建 IP 层
    const ipLayer = createIPLayer({
      redisUrl: redisConfig.redisUrl,
      deviceId: redisConfig.deviceId,
    });
    
    // 2. 启动 IP 层订阅
    await ipLayer.start({
      onMessage: (segment: TcpSegment) => {
        // 收到 TCP Segment
        handleInboundMessage(segment, redisConfig, handlerDeps);
      },
      onDisconnect: () => {
        // 断联处理
        console.log('Redis 连接断开');
        // 清理会话等
      },
    });
    
    // 3. 等待停止信号
    await new Promise<void>((resolve) => {
      abortSignal?.addEventListener('abort', () => {
        ipLayer.stop();
        resolve();
      });
    });
  }
}
```

### 发送流程

```typescript
// src/business/session-service.ts
async sendMessage(account, targetDeviceId, sessionKey, text) {
  const session = this.getOrCreateSession(...);
  
  // 通过 TCP 层发送
  await session.stack.appLayer.sendMessage(appMessage);
  // ↓ TCP Layer
  // ↓ IP Layer.send(targetDeviceId, segment)
  // ↓ Redis Publish
}
```

### 接收流程

```typescript
// src/index.ts (startAccount)
await ipLayer.start({
  onMessage: (segment: TcpSegment) => {
    // IP 层已拆包，直接是 TcpSegment
    handleInboundMessage(segment, redisConfig, handlerDeps);
  }
});

// src/lib/message-handler.ts
export async function handleInboundMessage(segment, account, deps) {
  // 提取应用层数据
  const appMessage = segment.payload[0];
  
  // 转换为 NormalizedMessage
  const normalizedMessage = {
    id: `tcp-${segment._tcp.connection_id}-${segment._tcp.seq}`,
    text: appMessage.data?.text,
    metadata: { tcp: {...}, appMessage },
  };
  
  // 传递给 agent
  deps.emitMessage(normalizedMessage);
}
```

## 🎯 优势

### 1. 职责清晰

| 层 | 职责 |
|------|------|
| **IP 层** | Redis 连接、订阅、装包/拆包、断联通知 |
| **TCP 层** | seq/ack、重传、连接管理 |
| **插件层** | 启动 IP 层、传递回调、消息分发 |

### 2. 统一管理

- ✅ 所有订阅在插件层统一管理
- ✅ 断联回调统一处理
- ✅ 避免重复订阅

### 3. 易于测试

```typescript
// 测试 IP 层
const ipLayer = createIPLayer(config);
await ipLayer.start({
  onMessage: (segment) => { ... },
  onDisconnect: () => { ... },
});

// 测试断联
ipLayer.stop();
expect(ipLayer.isConnected()).toBe(false);
```

### 4. 断联处理

```typescript
await ipLayer.start({
  onMessage: (segment) => { ... },
  onDisconnect: () => {
    // 清理会话
    sessionService.closeAll();
    
    // 通知用户
    notifyUser('Redis 连接断开，正在重连...');
    
    // 自动重连
    reconnect();
  },
});
```

## 📊 对比

### 之前

```typescript
// TCP 层自己订阅
class TcpLayer {
  async start() {
    await this.ipLayer.onReceive(deviceId, callback);
  }
}

// 插件层也订阅
await subscriber.subscribe(channel, callback);

// ❌ 重复订阅，职责不清
```

### 之后

```typescript
// 插件层统一订阅
await ipLayer.start({
  onMessage: (segment) => handleInboundMessage(segment),
  onDisconnect: () => cleanup(),
});

// TCP 层不直接调用 IP 层订阅
class TcpLayer {
  async start() {
    // 只启动 TCP 逻辑
  }
  
  handleIncomingMessage(segment) {
    // 处理收到的消息
  }
}

// ✅ 职责清晰，统一管理
```

## 🧪 测试

### IP 层测试

```typescript
describe('IP Layer', () => {
  it('should start subscription', async () => {
    const ipLayer = createIPLayer(config);
    
    const messages: TcpSegment[] = [];
    await ipLayer.start({
      onMessage: (segment) => messages.push(segment),
      onDisconnect: () => {},
    });
    
    expect(ipLayer.isConnected()).toBe(true);
    
    await ipLayer.stop();
    expect(ipLayer.isConnected()).toBe(false);
  });
  
  it('should handle disconnect', async () => {
    const ipLayer = createIPLayer(config);
    
    let disconnected = false;
    await ipLayer.start({
      onMessage: () => {},
      onDisconnect: () => { disconnected = true; },
    });
    
    // 模拟断联
    ipLayer['subscriber'].emit('end');
    
    expect(disconnected).toBe(true);
  });
});
```

### 插件层测试

```typescript
describe('Plugin startAccount', () => {
  it('should start IP layer with callbacks', async () => {
    const mockIpLayer = {
      start: jest.fn(),
      stop: jest.fn(),
    };
    
    await plugin.gateway.startAccount({
      account: redisConfig,
      abortSignal: new AbortController().signal,
    });
    
    expect(mockIpLayer.start).toHaveBeenCalledWith({
      onMessage: expect.any(Function),
      onDisconnect: expect.any(Function),
    });
  });
});
```

---

**版本**: 3.0.5  
**日期**: 2026-03-11  
**状态**: ✅ 重构完成
