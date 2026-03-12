# Redis TCP Channel - 最终架构文档

**版本**: 2.0.0  
**日期**: 2026-03-12  
**状态**: ✅ 架构重构完成

---

## 🏗️ 四层架构设计

```
┌──────────────────────────────────────────┐
│   Physical Layer (物理层)                │
│   - Redis 连接管理（长连接）              │
│   - 订阅频道、发布消息                    │
│   - 生命周期 = 插件生命周期              │
│   - gateway.startAccount() 创建          │
│   - gateway.stopAccount() 销毁           │
└──────────────┬───────────────────────────┘
               │ publish(channel, message)
               │ subscribe(channel, callback)
┌──────────────▼───────────────────────────┐
│   IP Layer (网络层)                      │
│   - 装包（TcpSegment → JSON）            │
│   - 拆包（JSON → TcpSegment）            │
│   - 无状态，注入 PhysicalLayer           │
└──────────────┬───────────────────────────┘
               │ TcpSegment
┌──────────────▼───────────────────────────┐
│   TCP Layer (传输层)                     │
│   - seq/ack 序号管理                     │
│   - 超时重传（max 3 次）                  │
│   - 连接状态机（SYN/ESTABLISHED/FIN）    │
└──────────────┬───────────────────────────┘
               │ AppMessage
┌──────────────▼───────────────────────────┐
│   Application Layer (应用层)             │
│   - onMessage() 消息回调                 │
│   - sendMessage() 发送接口               │
│   - 业务逻辑处理                         │
└──────────────────────────────────────────┘
```

---

## 📦 核心组件

### 1. PhysicalLayer（物理层）

**文件**: `src/lib/physical-layer.ts`

**职责**:
- 管理 Redis 连接（subscriber + publisher）
- 订阅频道接收消息
- 发布消息到频道
- 分发消息到 callbacks

**生命周期**:
```
gateway.startAccount()
  ↓
创建 PhysicalLayer
  ↓
启动（连接 Redis、订阅频道）
  ↓
保持运行（等待消息）
  ↓
gateway.stopAccount()
  ↓
停止（断开连接、取消订阅）
```

**代码示例**:
```typescript
const physicalLayer = createPhysicalLayer({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
});

await physicalLayer.start({
  onMessage: (channel, message) => {
    console.log(`收到：${channel} → ${message}`);
  },
  onDisconnect: () => {
    console.warn('断联');
  }
});

// 发布消息
await physicalLayer.publish('device-b', 'Hello!');

// 停止
await physicalLayer.stop();
```

---

### 2. IP Layer（网络层）

**文件**: `src/modules/ip-layer/ip-layer.ts`

**职责**:
- 装包：TcpSegment → JSON
- 拆包：JSON → TcpSegment
- 注入 PhysicalLayer 进行实际收发

**变更**:
- ❌ 移除：Redis 连接管理
- ✅ 新增：`setPhysicalLayer()` 方法
- ✅ 使用：PhysicalLayer.publish()

**代码示例**:
```typescript
const ipLayer = createIPLayer({
  deviceId: 'device-a',
});

// 注入 PhysicalLayer
ipLayer.setPhysicalLayer(physicalLayer);

// 启动（注册回调）
ipLayer.start({
  onMessage: (segment) => {
    console.log('收到 Segment:', segment);
  }
});

// 发送
await ipLayer.send('device-b', segment);
```

---

### 3. TCP Layer（传输层）

**文件**: `src/modules/tcp-layer/tcp-layer.ts`

**职责**:
- seq/ack 序号管理
- 超时重传
- 连接状态机

**状态流转**:
```
CLOSED → SYN_SENT → ESTABLISHED → FIN_WAIT → CLOSED
            ↓
        SYN_RCVD
```

**握手流程**:
```
Sender                    Receiver
  │─── SYN (data) ───────>│  1. 发送 SYN（含第一条消息）
  │                       │  2. 提取 payload，回调 onMessage()
  │<── SYN+ACK ───────────│  3. 回复 SYN+ACK
  │─── ACK ──────────────>│  4. 确认连接
  │                       │  5. 连接建立 (ESTABLISHED)
  │─── DATA ─────────────>│  6. 发送数据
  │<── ACK ───────────────│  7. 确认收到
```

---

### 4. Application Layer（应用层）

**文件**: `src/modules/app-layer/app-layer.ts`

**职责**:
- 提供 onMessage() 回调接口
- 提供 sendMessage() 发送接口
- 处理业务逻辑

**代码示例**:
```typescript
const appLayer = createAppLayer(tcpLayer, isInitiator, initialMessage);

// 注册消息回调
appLayer.onMessage((msg) => {
  console.log('收到应用层消息:', msg.data);
});

// 启动
await appLayer.start();

// 发送消息
await appLayer.sendMessage({
  type: 'message',
  data: { text: 'Hello!' },
  timestamp: Date.now(),
});
```

---

### 5. RedisChannelStack（统一封装）

**文件**: `src/modules/index.ts`

**职责**:
- 封装四层架构
- 提供简洁的 API
- 支持 PhysicalLayer 注入

**代码示例**:
```typescript
const stack = createRedisChannelStack({
  deviceId: 'device-a',
  targetDeviceId: 'device-b',
  connectionId: 'session-001',
  isInitiator: true,
  initialMessage: {...},
});

// 注入 PhysicalLayer（由 gateway 创建）
stack.setPhysicalLayer(physicalLayer);

// 注册回调
stack.onMessage((msg) => {
  console.log('收到:', msg.data);
});

// 启动
await stack.start();

// 发送
await stack.sendMessage({...});

// 停止
await stack.stop();
```

---

### 6. SessionService（会话管理）

**文件**: `src/business/session-service.ts`

**职责**:
- 管理 PhysicalLayer（全局单例）
- 管理 Inbound Stack（全局单例）
- 管理 Outbound Stacks（按需创建/复用）

**架构**:
```typescript
class SessionService {
  private physicalLayer?: IPhysicalLayer;  // 全局单例
  private inboundStack?: RedisChannelStack;  // 全局单例
  private sessions: Map<string, SessionInfo> = new Map();  // Outbound 会话池
  
  setPhysicalLayer(layer: IPhysicalLayer) { ... }
  setInboundStack(stack: RedisChannelStack) { ... }
  
  async sendMessage(account, targetDeviceId, sessionKey, text) {
    // 检查会话是否存在
    let session = this.sessions.get(sessionKey);
    
    if (!session) {
      // 创建 Outbound Stack
      const stack = createRedisChannelStack({...});
      stack.setPhysicalLayer(this.physicalLayer);
      await stack.start();
      session = { stack, ... };
      this.sessions.set(sessionKey, session);
    }
    
    // 发送消息
    await session.stack.sendMessage({...});
  }
}
```

---

## 🔄 Gateway 集成

### gateway.startAccount()

**文件**: `src/index.ts`

**流程**:
```typescript
gateway: {
  startAccount: async (params) => {
    // 1. 创建 PhysicalLayer（长连接）
    const physicalLayer = createPhysicalLayer({...});
    
    // 2. 启动 PhysicalLayer
    await physicalLayer.start({
      onMessage: (channel, message) => {...},
      onDisconnect: () => {...}
    });
    
    // 3. 创建 Inbound Stack
    const inboundStack = createRedisChannelStack({
      deviceId: redisConfig.deviceId,
      targetDeviceId: '*',  // 监听所有设备
      connectionId: `inbound-${deviceId}`,
      isInitiator: false,
    });
    
    // 4. 注入 PhysicalLayer
    inboundStack.setPhysicalLayer(physicalLayer);
    
    // 5. 注册消息回调
    inboundStack.onMessage(async (appMessage) => {
      const normalizedMsg = {...};
      await handlerDeps.emitMessage(normalizedMsg);
    });
    
    // 6. 启动
    await inboundStack.start();
    
    // 7. 保存到 SessionService
    sessionService.setPhysicalLayer(physicalLayer);
    sessionService.setInboundStack(inboundStack);
    
    // 8. 等待停止信号
    await new Promise((resolve) => {
      abortSignal.addEventListener('abort', async () => {
        await inboundStack.stop();
        await physicalLayer.stop();
        resolve();
      });
    });
  }
}
```

### gateway.stopAccount()

**流程**:
```typescript
stopFunction = async () => {
  // 1. 停止 Inbound Stack
  await sessionService.inboundStack.stop();
  
  // 2. 停止 PhysicalLayer
  // （PhysicalLayer 在 stop() 中自动断开连接）
  
  // 3. 清理资源
  ...
};
```

---

## 📊 资源管理

### PhysicalLayer（全局单例）

| 属性 | 说明 |
|------|------|
| 数量 | 1 个 / 插件 |
| 生命周期 | gateway.startAccount → gateway.stopAccount |
| Redis 连接 | subscriber + publisher |
| 订阅频道 | openclaw:device:{deviceId} |

### Inbound Stack（全局单例）

| 属性 | 说明 |
|------|------|
| 数量 | 1 个 / 插件 |
| 生命周期 | gateway.startAccount → gateway.stopAccount |
| 职责 | 监听所有设备的连接请求 |
| targetDeviceId | '*'（通配符） |

### Outbound Stacks（按需创建）

| 属性 | 说明 |
|------|------|
| 数量 | N 个（按会话） |
| 生命周期 | 创建 → 5 分钟无活动 → 自动清理 |
| 职责 | 发送消息到特定目标 |
| 复用 | 相同 sessionKey 复用 |

---

## ✅ 架构优势

### 1. 清晰的职责分离

| 层 | 职责 | 生命周期 |
|----|------|----------|
| Physical | Redis 连接 | 插件级 |
| IP | 装包/拆包 | 会话级 |
| TCP | 可靠传输 | 会话级 |
| App | 业务逻辑 | 会话级 |

### 2. 资源优化

- PhysicalLayer 全局单例，避免重复连接
- Stacks 按需创建，超时自动清理
- 内存占用低，连接数可控

### 3. 可靠性

- Receiver 在 gateway 启动时就开始监听
- 不会错过任何传入连接
- 支持多设备同时连接

### 4. 可维护性

- 各层职责清晰，易于测试
- 修改一层不影响其他层
- 代码结构简洁

---

## 🧪 测试验证

### 单元测试

```bash
# PhysicalLayer 测试
node test/test-physical-layer.js

# IP Layer 测试（Mock PhysicalLayer）
node test/test-ip-layer.js

# TCP Layer 测试
node test/test-tcp-layer.js
```

### 集成测试

```bash
# 双终端测试
node test-tcp-stack.js --role=receiver
node test-tcp-stack.js --role=initiator

# 完整测试
node test-full-integration.js

# session-send 模拟
node test-session-send-full.js
```

### Gateway 测试

```bash
# 启动 Gateway
openclaw gateway start

# 发送消息
openclaw session-send --to=device-b \
  --channel=redis-tcp-channel "Hello"

# 查看日志
openclaw logs | grep redis-tcp-channel
```

---

## 📚 相关文档

- [README.md](./README.md) - 项目说明
- [README-TCP.md](./README-TCP.md) - TCP 模式指南
- [TEST-RESULTS.md](./TEST-RESULTS.md) - 测试报告
- [GATEWAY-REFACTOR.md](./GATEWAY-REFACTOR.md) - 重构计划
- [ARCHITECTURE-FIX.md](./ARCHITECTURE-FIX.md) - 架构修正

---

**版本**: 2.0.0  
**日期**: 2026-03-12  
**状态**: ✅ 架构重构完成，编译通过
