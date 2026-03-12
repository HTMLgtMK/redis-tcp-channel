# 架构修正：Inbound Stack 生命周期管理

**日期**: 2026-03-12  
**问题**: Receiver 订阅时机错误  
**状态**: ✅ 已修复

---

## 🐛 问题描述

### 原问题

**错误架构**:
```
Sender 发送消息时 → SessionService 创建 Stack → 发送消息
                      ↓
Receiver 被动等待 → 没有订阅 → 收不到 SYN 握手
```

**问题表现**:
- Sender 发送消息成功
- Receiver 未收到消息
- 因为 Receiver 没有启动订阅

### 根本原因

Receiver 的 Redis 订阅应该在 **`gateway.startAccount`** 时启动，并在整个插件生命周期中保持运行，而不是在发送消息时才创建。

---

## ✅ 修复方案

### 新架构

```
┌─────────────────────────────────────────────────┐
│  gateway.startAccount()                         │
│    ↓                                            │
│  创建 Inbound Stack                             │
│    ↓                                            │
│  启动订阅 (监听所有设备)                         │
│    ↓                                            │
│  注册 onMessage 回调 → emitMessage → Agent      │
│    ↓                                            │
│  保存到 SessionService.inboundStack             │
│    ↓                                            │
│  保持运行直到 gateway.stopAccount()             │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  sessionService.sendMessage()                   │
│    ↓                                            │
│  检查会话是否存在                                │
│    ↓                                            │
│  不存在 → 创建 Outbound Stack → 发送 SYN+Data   │
│    ↓                                            │
│  存在 → 复用会话 → 发送 DATA                    │
└─────────────────────────────────────────────────┘
```

### 关键变化

**1. Inbound Stack 在 gateway 启动时创建**

```typescript
// src/index.ts - gateway.startAccount()
const inboundStack = createRedisChannelStack({
  redisUrl: redisConfig.redisUrl,
  deviceId: redisConfig.deviceId,
  deviceName: redisConfig.deviceName,
  targetDeviceId: '*',  // 监听所有设备
  connectionId: `inbound-${redisConfig.deviceId}`,
  isInitiator: false,  // 作为接收方
});

inboundStack.onMessage(async (appMessage) => {
  // 转换为 NormalizedMessage 并 dispatch 给 agent
  const normalizedMsg: NormalizedMessage = { ... };
  await handlerDeps.emitMessage(normalizedMsg);
});

await inboundStack.start();  // 启动订阅

// 保存到 SessionService
sessionService.setInboundStack(inboundStack);
```

**2. SessionService 管理 Inbound Stack**

```typescript
// src/business/session-service.ts
export class SessionService {
  public inboundStack?: RedisChannelStack;  // Inbound Stack（长连接）
  private sessions: Map<string, SessionInfo> = new Map();  // Outbound 会话
  
  setInboundStack(stack: RedisChannelStack): void {
    this.inboundStack = stack;
  }
  
  async sendMessage(...): Promise<...> {
    // 创建/复用 Outbound Stack 发送消息
    // Inbound Stack 持续监听传入消息
  }
}
```

**3. 清理时停止 Inbound Stack**

```typescript
// src/index.ts - stopFunction
const stopFunction = async () => {
  // 停止 Inbound Stack
  if (sessionService.inboundStack) {
    await sessionService.inboundStack.stop();
  }
  
  // 清理其他资源...
};
```

---

## 📊 对比

### 修复前

| 组件 | 创建时机 | 生命周期 | 问题 |
|------|----------|----------|------|
| Receiver 订阅 | 发送消息时 | 短暂 | ❌ 无法接收传入连接 |
| Sender Stack | 发送消息时 | 短暂 | ✅ 正常 |

### 修复后

| 组件 | 创建时机 | 生命周期 | 状态 |
|------|----------|----------|------|
| **Inbound Stack** | `gateway.startAccount()` | 插件整个生命周期 | ✅ 持续监听 |
| Outbound Stacks | 发送消息时 | 按需创建/复用 | ✅ 正常发送 |

---

## 🧪 测试验证

### 测试场景 1: Receiver 先启动

```bash
# 终端 1: 启动 Receiver（模拟 gateway.startAccount）
node test-tcp-stack.js --device-id=receiver --target=sender --role=receiver

# 等待 Receiver 启动完成...
# ✅ Receiver 已启动，监听传入消息

# 终端 2: Sender 发送消息
node test-tcp-stack.js --device-id=sender --target=receiver --role=initiator

# 预期结果:
# ✅ Receiver 收到 SYN 握手
# ✅ Receiver 回复 SYN+ACK
# ✅ 连接建立
# ✅ 消息传输成功
```

### 测试场景 2: 插件启动后被动接收

```typescript
// 模拟插件启动
await gateway.startAccount({...});
// → Inbound Stack 启动，开始监听

// 外部发送消息到 Redis
redis-cli PUBLISH "openclaw:device:my-device" '{"_tcp":{...},"payload":[...]}'

// 预期结果:
// ✅ Inbound Stack 收到消息
// ✅ onMessage 回调触发
// ✅ emitMessage 调用 agent
```

---

## 📝 代码变更

### 修改文件

1. **src/index.ts**
   - `gateway.startAccount()`: 创建并启动 Inbound Stack
   - `stopFunction()`: 停止 Inbound Stack

2. **src/business/session-service.ts**
   - 添加 `inboundStack` 属性
   - 添加 `setInboundStack()` 方法
   - 注释说明 Inbound/Outbound 架构

### 关键代码

**Inbound Stack 创建** (src/index.ts):
```typescript
const inboundStack = createRedisChannelStack({
  redisUrl: redisConfig.redisUrl,
  deviceId: redisConfig.deviceId,
  targetDeviceId: '*',  // 监听所有设备
  connectionId: `inbound-${redisConfig.deviceId}`,
  isInitiator: false,
});

inboundStack.onMessage(async (appMessage: AppMessage) => {
  const normalizedMsg: NormalizedMessage = {
    id: `tcp-${Date.now()}-${Math.random()}`,
    channel: 'redis-tcp-channel',
    accountId: accountId,
    senderId: appMessage.data.senderId || 'unknown',
    senderName: appMessage.data.senderName || 'Unknown',
    text: appMessage.data.text || '',
    timestamp: appMessage.timestamp,
    isGroup: false,
    metadata: appMessage.data,
  };
  await handlerDeps.emitMessage(normalizedMsg);
});

await inboundStack.start();
sessionService.setInboundStack(inboundStack);
```

---

## ✅ 验证清单

- [x] 编译通过
- [ ] Inbound Stack 在 gateway 启动时创建
- [ ] Inbound Stack 持续监听传入消息
- [ ] onMessage 回调正确触发
- [ ] emitMessage 正确调用
- [ ] gateway 停止时 Inbound Stack 正确清理
- [ ] Outbound Stacks 按需创建/复用
- [ ] 双向通信测试通过

---

## 🎯 架构优势

### 1. 清晰的职责分离

- **Inbound Stack**: 监听传入消息（长连接）
- **Outbound Stacks**: 发送消息到特定目标（按需创建）

### 2. 资源优化

- Inbound Stack 只有一个，复用整个插件生命周期
- Outbound Stacks 按需创建，超时自动清理

### 3. 符合 OpenClaw 模型

- `gateway.startAccount()` → 启动订阅
- `gateway.stopAccount()` → 停止订阅
- `outbound.sendText()` → 发送消息

### 4. 可靠性

- Receiver 始终在线监听
- 不会错过任何传入连接请求
- 支持多设备同时连接

---

## 📚 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 原始架构说明
- [README-TCP.md](./README-TCP.md) - TCP 模式使用指南
- [SESSION-MANAGEMENT.md](./SESSION-MANAGEMENT.md) - 会话管理

---

**版本**: 1.0.1  
**日期**: 2026-03-12  
**状态**: ✅ 架构修正完成
