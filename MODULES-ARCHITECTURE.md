# Redis Channel 模块化架构

## 📐 三层架构

```
┌─────────────────────────────────────────────────┐
│  Application Layer (应用层)                     │
│  src/modules/application/                       │
│  - app-layer.ts                                 │
│  - 处理业务逻辑、消息格式化                       │
├─────────────────────────────────────────────────┤
│  Transport Layer (传输层)                       │
│  src/modules/transport/                         │
│  - tcp-transport.ts                             │
│  - session-manager.ts                           │
│  - seq/ack、重传、连接管理                       │
├─────────────────────────────────────────────────┤
│  Network Layer (IP 层)                          │
│  src/modules/network/                           │
│  - ip-layer-redis.ts                            │
│  - Redis Pub/Sub                                │
│  - 只管收发，不保证可靠                          │
└─────────────────────────────────────────────────┘
```

## 📁 目录结构

```
src/
├── modules/
│   ├── network/              # IP 层
│   │   ├── types.ts          # IP 层类型定义
│   │   └── ip-layer-redis.ts # Redis IP 层实现
│   ├── transport/            # 传输层
│   │   ├── types.ts          # TCP 类型定义
│   │   ├── tcp-transport.ts  # TCP 传输层实现
│   │   └── session-manager.ts# 会话管理
│   ├── application/          # 应用层
│   │   └── app-layer.ts      # 应用层实现
│   └── index.ts              # 统一导出
├── lib/                      # 原有代码（逐步迁移）
│   ├── message-sender.ts
│   ├── message-handler.ts
│   └── ...
└── index.ts                  # 插件入口
```

## 🔄 消息流程

### 发送（Outbound）

```
Application
    ↓
AppLayer.sendMessage()
    ↓
SessionManager.sendViaTcp()
    ↓
TcpTransport.send()
    ↓
IPLayer.send()
    ↓
Redis Publish
```

### 接收（Inbound）

```
Redis Subscribe
    ↓
IPLayer.subscribe()
    ↓
TcpTransport._handleIncoming()
    ↓
AppLayer.onMessage()
    ↓
Application
```

## 🚀 使用方式

### 方式 1：完整栈（推荐）

```typescript
import { createRedisChannelStack } from './modules';

const stack = createRedisChannelStack({
  network: {
    redisUrl: 'redis://localhost:6379',
    deviceId: 'device-a',
  },
  transport: {
    maxRounds: 15,
    maxRetransmit: 3,
  },
});

await stack.start();

// 创建应用层
const appLayer = stack.createApplicationLayer('session-001', 'device-b');

// 注册回调
appLayer.onMessage((msg) => {
  console.log('收到消息:', msg);
});

appLayer.onConnected(() => {
  console.log('连接已建立');
});

// 发送消息
await appLayer.sendMessage({
  type: 'greeting',
  data: { message: 'Hello!' },
  timestamp: Date.now(),
});
```

### 方式 2：分层使用

```typescript
import { createIPLayer } from './modules/network';
import { createTransport } from './modules/transport';
import { createApplicationLayer } from './modules/application';

// 1. 创建 IP 层
const ipLayer = createIPLayer({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
});
await ipLayer.initialize();

// 2. 创建传输层
const transport = createTransport(
  'session-001',
  (segment) => ipLayer.send('device-b', segment),
  (callback) => ipLayer.subscribe('device-a', callback),
  () => ipLayer.unsubscribe(),
);

// 3. 创建应用层
const appLayer = createApplicationLayer(transport);
await transport.start();

// 4. 使用
appLayer.onMessage((msg) => console.log(msg));
await appLayer.sendMessage({ type: 'hello', data: {}, timestamp: Date.now() });
```

### 方式 3：仅 IP 层（原有方式）

```typescript
import { createIPLayer } from './modules/network';

const ipLayer = createIPLayer({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
});

await ipLayer.send('device-b', {
  senderId: 'device-a',
  text: 'Hello',
  timestamp: Date.now(),
});
```

## 📊 消息格式

### IP 层消息
```json
{
  "senderId": "device-a",
  "senderName": "Device A",
  "text": "Hello",
  "timestamp": 1710156000
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
      "type": "greeting",
      "data": { "message": "Hello!" },
      "timestamp": 1710156000
    }
  ]
}
```

## 🎯 模块职责

### Network Layer (IP 层)
- ✅ Redis 连接管理
- ✅ Pub/Sub 订阅/发布
- ✅ 原始消息发送/接收
- ❌ 不保证可靠性
- ❌ 不处理 seq/ack

### Transport Layer (传输层)
- ✅ 连接管理（握手、断开）
- ✅ seq/ack 机制
- ✅ 超时重传
- ✅ 流量控制（窗口=1）
- ✅ 状态机管理

### Application Layer (应用层)
- ✅ 消息格式化
- ✅ 业务逻辑处理
- ✅ 应用层回调
- ❌ 不关心底层传输细节

## 🔧 配置选项

### IP 层配置
```typescript
{
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
  deviceName?: 'Device A',
  subscribeChannel?: 'openclaw:device:device-a',
  publishChannel?: 'openclaw:device:device-b',
}
```

### 传输层配置
```typescript
{
  max_retransmit: 3,         // 最大重传次数
  initial_timeout_ms: 5000,  // 初始超时
  timeout_multiplier: 2,     // 超时倍增
  max_rounds: 15,            // 最大会话轮次
  window_size: 1,            // 窗口大小
}
```

## 📝 迁移计划

### Phase 1: 模块化（已完成）
- [x] 创建 modules 目录结构
- [x] 实现 Network Layer
- [x] 实现 Transport Layer
- [x] 实现 Application Layer
- [x] 统一导出

### Phase 2: 集成（进行中）
- [ ] 修改 `message-sender.ts` 使用新模块
- [ ] 修改 `message-handler.ts` 使用新模块
- [ ] 修改 `index.ts` 初始化模块栈

### Phase 3: 清理
- [ ] 迁移原有代码到新模块
- [ ] 删除旧代码
- [ ] 更新文档

---

**版本**: 2.0.0  
**作者**: GWork  
**日期**: 2026-03-11
