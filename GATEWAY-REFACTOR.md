# Gateway 重构计划 - Physical Layer 分离

**目标**: 将 Redis 订阅/发布逻辑从 IP 层剥离到 Physical Layer，在插件整个生命周期存在。

---

## 架构变更

### 原架构（错误）

```
gateway.startAccount()
  ↓
创建 Redis 订阅（短暂）
  ↓
sendText() 时创建 Stack
  ↓
问题：Receiver 无法被动监听
```

### 新架构（正确）

```
┌──────────────────────────────────────┐
│ gateway.startAccount()               │
│   ↓                                  │
│ 创建 PhysicalLayer（长连接）          │
│   - 连接 Redis                       │
│   - 订阅频道                         │
│   - 分发消息到 Stack                 │
│   ↓                                  │
│ 创建 Inbound Stack（可选）           │
│   - 监听所有设备的连接请求            │
│   - 注册 onMessage 回调              │
│   ↓                                  │
│ 保持运行直到 gateway.stopAccount()  │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ sessionService.sendMessage()         │
│   ↓                                  │
│ 创建/复用 Outbound Stack            │
│   - 注入 PhysicalLayer               │
│   - 发送 SYN/DATA                    │
│   - 超时清理                         │
└──────────────────────────────────────┘
```

---

## 代码变更

### 1. 创建 PhysicalLayer

**文件**: `src/lib/physical-layer.ts` ✅ 已创建

职责:
- 管理 Redis 连接（subscriber + publisher）
- 订阅频道
- 发布消息
- 分发消息到 callbacks

### 2. 修改 IP Layer

**文件**: `src/modules/ip-layer/ip-layer.ts` ✅ 已修改

变更:
- 移除 Redis 连接管理
- 添加 `setPhysicalLayer()` 方法
- 使用 PhysicalLayer 进行发布

### 3. 修改 Stack

**文件**: `src/modules/index.ts` ✅ 已修改

变更:
- 添加 `setPhysicalLayer()` 方法
- 移除 Redis 连接参数
- 注入 PhysicalLayer

### 4. 修改 gateway.startAccount()

**文件**: `src/index.ts` ⏳ 待修改

伪代码:

```typescript
gateway: {
  startAccount: async (params) => {
    const { cfg, accountId, account: redisConfig, abortSignal, log } = params;
    
    // 1. 创建 PhysicalLayer（长连接）
    const physicalLayer = createPhysicalLayer({
      redisUrl: redisConfig.redisUrl,
      deviceId: redisConfig.deviceId,
      deviceName: redisConfig.deviceName,
    }, log);
    
    // 2. 启动 PhysicalLayer
    await physicalLayer.start({
      onMessage: (channel, message) => {
        // 分发消息到对应的 Stack
        // 根据 connectionId 路由到 Outbound Stack
        // 或创建新的 Inbound Stack 处理
      },
      onDisconnect: () => {
        log.warn('[PhysicalLayer] 断联');
      }
    });
    
    // 3. 创建 Inbound Stack（监听所有设备）
    const inboundStack = createRedisChannelStack({
      deviceId: redisConfig.deviceId,
      targetDeviceId: '*',
      connectionId: `inbound-${redisConfig.deviceId}`,
      isInitiator: false,
    });
    
    // 4. 注入 PhysicalLayer
    inboundStack.setPhysicalLayer(physicalLayer);
    
    // 5. 注册消息回调
    inboundStack.onMessage(async (appMessage) => {
      const normalizedMsg: NormalizedMessage = {...};
      await handlerDeps.emitMessage(normalizedMsg);
    });
    
    // 6. 启动 Inbound Stack
    await inboundStack.start();
    
    // 7. 保存到 SessionService
    sessionService.setPhysicalLayer(physicalLayer);
    sessionService.setInboundStack(inboundStack);
    
    // 8. 等待停止信号
    await new Promise<void>((resolve) => {
      abortSignal?.addEventListener('abort', async () => {
        // 停止 Inbound Stack
        await inboundStack.stop();
        // 停止 PhysicalLayer
        await physicalLayer.stop();
        resolve();
      });
    });
    
    return { stop: ..., health: ... };
  }
}
```

### 5. 修改 SessionService

**文件**: `src/business/session-service.ts` ✅ 已部分修改

需要添加:

```typescript
export class SessionService {
  private physicalLayer?: IPhysicalLayer;  // PhysicalLayer（长连接）
  private inboundStack?: RedisChannelStack;  // Inbound Stack
  private sessions: Map<string, SessionInfo> = new Map();  // Outbound 会话
  
  setPhysicalLayer(layer: IPhysicalLayer): void {
    this.physicalLayer = layer;
  }
  
  async sendMessage(account, targetDeviceId, sessionKey, text): Promise<...> {
    // 检查会话是否存在
    let session = this.sessions.get(sessionKey);
    
    if (!session) {
      // 创建 Outbound Stack
      const stack = createRedisChannelStack({
        deviceId: account.deviceId,
        targetDeviceId,
        connectionId: `tcp-${sessionKey}`,
        isInitiator: true,
        initialMessage: {...},
      });
      
      // 注入 PhysicalLayer
      if (this.physicalLayer) {
        stack.setPhysicalLayer(this.physicalLayer);
      }
      
      // 启动 Stack
      await stack.start();
      
      session = { stack, ... };
      this.sessions.set(sessionKey, session);
    } else {
      // 复用会话，直接发送
      await session.stack.sendMessage({...});
    }
  }
}
```

---

## 测试计划

### 1. 单元测试

```bash
# PhysicalLayer 测试
node test/test-physical-layer.js

# IP Layer 测试（使用 Mock PhysicalLayer）
node test/test-ip-layer.js
```

### 2. 集成测试

```bash
# 双终端测试
node test-tcp-stack.js --role=receiver
node test-tcp-stack.js --role=initiator

# 完整测试
node test-full-integration.js
```

### 3. Gateway 测试

```bash
# 启动 Gateway
openclaw gateway start

# 发送消息
openclaw session-send --to=device-b --channel=redis-tcp-channel "Hello"

# 查看日志
openclaw logs | grep redis-tcp-channel
```

---

## 优势

### 1. 清晰的职责分离

- **PhysicalLayer**: Redis 连接管理（长连接）
- **IP Layer**: 装包/拆包
- **TCP Layer**: 可靠传输
- **App Layer**: 业务逻辑

### 2. 资源优化

- PhysicalLayer 只有一个，整个插件生命周期复用
- Stacks 按需创建，超时清理

### 3. 符合 OpenClaw 模型

- `gateway.startAccount()` → 创建 PhysicalLayer
- `gateway.stopAccount()` → 停止 PhysicalLayer
- `outbound.sendText()` → 创建/复用 Stack

### 4. 可靠性

- Receiver 始终在线监听
- 不会错过任何传入连接
- 支持多设备同时连接

---

## 下一步

1. ✅ 创建 PhysicalLayer
2. ✅ 修改 IP Layer
3. ✅ 修改 Stack
4. ⏳ 修改 gateway.startAccount()
5. ⏳ 修改 SessionService
6. ⏳ 测试验证
7. ⏳ 更新文档

---

**状态**: 重构中  
**日期**: 2026-03-12
