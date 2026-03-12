# Redis Channel 架构设计

## 📐 三层架构与数据流

```
┌─────────────────────────────────────────────────────────┐
│                    发送方 (Sender)                       │
│                                                          │
│  webchat / agent                                         │
│       ↓                                                  │
│  ┌─────────────────┐                                    │
│  │  Application    │  应用层：处理业务消息                │
│  │     Layer       │                                    │
│  └────────┬────────┘                                    │
│           ↓ toIpMessage()                                │
│  ┌─────────────────┐                                    │
│  │   TCP Layer     │  传输层：seq/ack、重传、可靠         │
│  └────────┬────────┘                                    │
│           ↓ send()                                       │
│  ┌─────────────────┐                                    │
│  │    IP Layer     │  IP 层：Redis Publish               │
│  └────────┬────────┘                                    │
│           ↓                                              │
│     Redis Pub/Sub                                        │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│                    接收方 (Receiver)                     │
│                                                          │
│     Redis Subscribe                                      │
│           ↓                                              │
│  ┌─────────────────┐                                    │
│  │    IP Layer     │  IP 层：接收原始消息                 │
│  └────────┬────────┘                                    │
│           ↓ receive()                                    │
│  ┌─────────────────┐                                    │
│  │   TCP Layer     │  传输层：处理 seq/ack、重组          │
│  └────────┬────────┘                                    │
│           ↓ onData()                                     │
│  ┌─────────────────┐                                    │
│  │  Application    │  应用层：解析业务消息                │
│  │     Layer       │                                    │
│  └────────┬────────┘                                    │
│           ↓                                              │
│       agent                                              │
└─────────────────────────────────────────────────────────┘
```

## 🔄 消息转换

### 发送流程

```
1. 应用层输入（webchat/agent）
   { type: 'message', text: 'Hello', ... }

2. TCP 层封装
   { _tcp: { seq: 1, ack: 2, flags: ['DATA'] }, payload: [...] }

3. IP 层发送（Redis Publish）
   JSON.stringify(tcpSegment)
```

### 接收流程

```
1. IP 层接收（Redis Subscribe）
   JSON.parse(rawMessage)

2. TCP 层处理
   验证 seq/ack → 触发 onData

3. 应用层输出（给 agent）
   { type: 'message', text: 'Hello', ... }
```

## 📁 目录结构

```
src/
├── modules/
│   ├── ip-layer/              # IP 层（Redis Pub/Sub）
│   │   ├── ip-layer.ts        # IP 层接口和实现
│   │   └── types.ts           # IP 层类型
│   │
│   ├── tcp-layer/             # TCP 层（传输层）
│   │   ├── tcp-layer.ts       # TCP 层接口和实现
│   │   ├── tcp-protocol.ts    # TCP 协议（seq/ack、状态机）
│   │   └── types.ts           # TCP 层类型
│   │
│   ├── app-layer/             # 应用层（业务逻辑）
│   │   ├── app-layer.ts       # 应用层接口和实现
│   │   └── types.ts           # 应用层类型
│   │
│   └── index.ts               # 统一导出
│
├── lib/                       # 原有代码（逐步迁移）
└── index.ts                   # 插件入口
```

## 🎯 各层职责

### IP Layer (IP 层)
**输入：** TCP 层的 `send(segment)`  
**输出：** 应用层的 `receive(segment)`

- ✅ Redis 连接管理
- ✅ Publish/Subscribe
- ✅ 原始消息收发
- ❌ 不处理 seq/ack
- ❌ 不保证可靠性

### TCP Layer (传输层)
**输入：** 应用层的 `send(data)` / IP 层的 `receive(segment)`  
**输出：** IP 层的 `send(segment)` / 应用层的 `onData(data)`

- ✅ seq/ack 机制
- ✅ 超时重传
- ✅ 连接管理（握手、断开）
- ✅ 流量控制（窗口=1）
- ✅ 状态机

### Application Layer (应用层)
**输入：** webchat/agent 的消息 / TCP 层的 `onData(data)`  
**输出：** TCP 层的 `send(data)` / agent 的消息

- ✅ 消息格式化
- ✅ 业务逻辑处理
- ✅ 与 agent 集成
- ❌ 不关心传输细节

## 🔌 接口定义

### IP Layer 接口

```typescript
interface IPLayer {
  // 发送（TCP 层调用）
  send(segment: TcpSegment): Promise<void>;
  
  // 接收（回调给 TCP 层）
  onReceive(callback: (segment: TcpSegment) => void): void;
}
```

### TCP Layer 接口

```typescript
interface TCPLayer {
  // 发送（应用层调用）
  send(data: AppMessage): Promise<void>;
  
  // 接收（回调给应用层）
  onData(callback: (data: AppMessage) => void): void;
  
  // 连接管理
  connect(): Promise<void>;
  close(): Promise<void>;
}
```

### Application Layer 接口

```typescript
interface AppLayer {
  // 发送（webchat/agent 调用）
  sendMessage(data: AppMessage): Promise<void>;
  
  // 接收（回调给 agent）
  onMessage(callback: (data: AppMessage) => void): void;
}
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
    "flags": ["DATA"],
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
  "_tcp": { ... },
  "payload": [...]
}
```

---

**版本**: 3.0.0  
**日期**: 2026-03-11
