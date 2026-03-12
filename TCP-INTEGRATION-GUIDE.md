# Redis Channel TCP 集成指南

## 📐 三层架构

```
┌─────────────────────────────────────────────────┐
│  应用层 (Application Layer)                     │
│  - channelRuntime / agent                       │
│  - handleInboundMessageDispatch                 │
│  - 处理业务逻辑                                 │
├─────────────────────────────────────────────────┤
│  传输层 (Transport Layer) ← 新增                │
│  - tcp-transport.ts                             │
│  - tcp-session-manager.ts                       │
│  - seq/ack、重传、连接管理                       │
├─────────────────────────────────────────────────┤
│  IP 层 (Network Layer)                          │
│  - redis-channel (原生)                          │
│  - Redis Pub/Sub                                │
│  - message-sender.ts / message-handler.ts       │
└─────────────────────────────────────────────────┘
```

## 🔄 消息流程

### 发送流程（Outbound）

```
Agent/Webchat
    ↓
sendOutboundMessageWithTcp (可选 TCP)
    ├─→ 普通模式：sendOutboundMessage → Redis Publish
    └─→ TCP 模式：TcpSessionManager → TcpTransport → Redis Publish
```

### 接收流程（Inbound）

```
Redis Subscribe
    ↓
handleInboundMessage
    ↓
检测 _tcp 字段
    ├─→ TCP Segment: handleTcpSegment → TcpSessionManager → emitMessage
    └─→ 普通消息：原有流程 → handleInboundMessageDispatch → agent
```

## 📦 新增文件

### 核心文件
- `src/lib/tcp-types.ts` - TCP 类型定义
- `src/lib/tcp-transport.ts` - TCP 传输层实现
- `src/lib/tcp-session-manager.ts` - TCP 会话管理

### 修改文件
- `src/lib/message-sender.ts` - 新增 `sendOutboundMessageWithTcp()`
- `src/lib/message-handler.ts` - 新增 `handleTcpSegment()`，改为 async
- `src/index.ts` - 调用 async `handleInboundMessage()`

## 🚀 使用方式

### 方式 1：普通消息（默认，不保证可靠）

```typescript
import { sendOutboundMessage } from './lib/message-sender';

await sendOutboundMessage(
  'Hello World',
  { id: 'target-device' },
  account
);
```

### 方式 2：TCP 可靠传输

```typescript
import { sendOutboundMessageWithTcp } from './lib/message-sender';

await sendOutboundMessageWithTcp(
  'Hello World',
  { id: 'target-device' },
  account,
  {
    useTcp: true,
    connectionId: 'session-001',  // 可选，自动生成
  }
);
```

### 方式 3：在 plugin 中配置

修改 `src/index.ts` 的 `sendText` 函数：

```typescript
sendText: async (ctx) => {
  const { text, to, accountId, cfg } = ctx;
  
  // 获取 account
  let account = getAccount(accountId, cfg);
  
  // 检查是否启用 TCP（从配置或消息元数据）
  const useTcp = ctx.metadata?.useTcp || false;
  const connectionId = ctx.metadata?.connectionId;
  
  // 发送
  return await sendOutboundMessageWithTcp(
    text,
    { id: to },
    account,
    { useTcp, connectionId }
  );
},
```

## 📊 TCP 消息格式

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
      "text": "Hello World",
      "timestamp": 1710156000
    }
  ]
}
```

## ⚙️ 配置选项

在 `openclaw.plugin.json` 或账户配置中添加：

```json
{
  "channels": {
    "redis-channel": {
      "accounts": {
        "default": {
          "enabled": true,
          "redisUrl": "redis://localhost:6379",
          "deviceId": "device-a",
          "tcp": {
            "enabled": true,
            "maxRounds": 15,
            "maxRetransmit": 3,
            "initialTimeoutMs": 5000
          }
        }
      }
    }
  }
}
```

## 🔍 调试

### 启用日志

```bash
DEBUG=redis-channel node ...
```

### 查看 TCP 会话状态

```typescript
import { getTcpSessionManager } from './lib/tcp-session-manager';

const manager = getTcpSessionManager(account);
const sessions = manager.listSessions();

sessions.forEach(session => {
  console.log(`会话：${session.sessionKey}`);
  console.log(`状态：`, session.status);
});
```

### 日志输出示例

```
[TCP-Session] 初始化会话管理器
[TCP-Session] 创建新会话：device-b:session-001
[TCP-Transport] 初始化：device-a -> device-b, connection=session-001
[TCP-Transport] 已启动
[TCP-Transport] 已发送 SYN
[TCP-Transport] 收到：flags=[SYN,ACK] seq=100
[TCP-Transport] 连接已建立
[TCP-Session] 发送数据：seq=1
[TCP-Transport] 收到：flags=[DATA,ACK] seq=101
```

## 🎯 特性

### 已实现
- ✅ seq/ack 机制
- ✅ 超时重传（指数退避）
- ✅ 连接状态机
- ✅ 窗口大小=1
- ✅ 最大 15 轮会话
- ✅ 自动握手和断开
- ✅ 向后兼容普通消息

### 待实现
- ⏳ 流量控制（zero window）
- ⏳ 选择性确认（SACK）
- ⏳ 多路复用（一个连接多个会话）
- ⏳ 连接持久化

## 📝 注意事项

1. **连接 ID**: 通信双方必须使用相同的 `connectionId`
2. **设备 ID**: 每个设备必须有唯一的 `deviceId`
3. **兼容性**: 普通消息和 TCP 消息可以共存
4. **性能**: TCP 模式有额外开销，仅在需要可靠传输时使用
5. **资源**: 每个 TCP 会话会占用一个 Redis 订阅连接

## 🐛 故障排除

### 问题 1: TCP 连接无法建立

检查：
- 双方 deviceId 是否正确
- connectionId 是否一致
- Redis 连接是否正常
- 防火墙/网络是否通畅

### 问题 2: 消息乱序

检查：
- 窗口大小设置（默认 1）
- 是否有多个发送方
- seq/ack 是否正确递增

### 问题 3: 重传过多

检查：
- 网络延迟
- timeout 设置（默认 5s）
- Redis 服务器性能

---

**版本**: 1.0.0  
**作者**: GWork  
**日期**: 2026-03-11
