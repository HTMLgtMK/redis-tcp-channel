# Redis TCP Channel 快速参考卡

**版本**: 1.0.0 | **日期**: 2026-03-12

---

## 🚀 快速命令

### 测试命令

```bash
# Redis 连接测试
node test-redis-connection.js

# TCP Stack 双终端测试
# 终端 1: node test-tcp-stack.js --role=receiver
# 终端 2: node test-tcp-stack.js --role=initiator

# 完整集成测试
node test-full-integration.js

# session-send 模拟测试
node test-session-send-full.js
```

### 构建命令

```bash
npm install
npm run build
```

---

## 📁 文件结构

```
redis-tcp-channel/
├── src/
│   ├── modules/          # 三层架构
│   │   ├── ip-layer/     # IP 层（Redis Pub/Sub）
│   │   ├── tcp-layer/    # TCP 层（可靠传输）
│   │   └── app-layer/    # 应用层（业务逻辑）
│   ├── business/         # 业务逻辑
│   │   └── session-service.ts
│   ├── lib/              # 工具库
│   └── index.ts          # 插件入口
├── test/                 # 测试脚本
├── dist/                 # 编译输出
└── docs/                 # 文档
```

---

## 🔑 关键代码

### 发送消息（SessionService）

```typescript
import { getSessionService } from './dist/business/session-service';

const sessionService = getSessionService();

const result = await sessionService.sendMessage(
  account,           // Redis 账号配置
  'device-b',        // 目标设备
  'session-key-001', // 会话 Key（复用连接）
  'Hello!'           // 消息内容
);
```

### 直接 Stack

```typescript
const stack = createRedisChannelStack({
  redisUrl: 'redis://localhost:6379',
  deviceId: 'device-a',
  targetDeviceId: 'device-b',
  connectionId: 'session-001',
  isInitiator: true,
});

stack.onMessage((msg) => console.log('收到:', msg.data));
await stack.start();
await stack.sendMessage({ type: 'message', data: { text: 'Hi!' } });
```

---

## 📊 配置参数

### 账号配置

```json
{
  "enabled": true,
  "redisUrl": "redis://localhost:6379",
  "deviceId": "device-a",
  "deviceName": "Device A",
  "targetSession": "agent:main:main"
}
```

### TCP 配置

```typescript
{
  max_retransmit: 3,         // 最大重传次数
  initial_timeout_ms: 5000,  // 初始超时 (ms)
  timeout_multiplier: 2,     // 超时倍增
  max_rounds: 15,            // 最大会话轮次
  window_size: 1,            // 窗口大小
}
```

---

## 🐛 常见问题

### IP-Layer not connected

**原因**: IP 层未启动就调用发送  
**解决**: 确保先调用 `stack.start()` 或使用 `sessionService.sendMessage()`（自动启动）

### 连接未建立 (CLOSED/SYN_SENT)

**原因**: initialMessage 为 undefined  
**解决**: 创建会话时传递第一条消息作为 initialMessage

### Receiver 未收到消息

**原因**: SYN 包 payload 未提取（已修复）  
**解决**: 升级到 v1.0.0+

---

## 📈 性能指标

| 指标 | 数值 | 备注 |
|------|------|------|
| Redis 连接延迟 | <10ms | 本地连接 |
| TCP 握手时间 | <50ms | 包含 RTT |
| 消息发送延迟 | <100ms | 端到端 |
| 消息到达率 | 100% | 测试期间 |
| 会话复用率 | 100% | 同 SessionKey |

---

## 📚 文档索引

| 文档 | 说明 |
|------|------|
| [README.md](./README.md) | 项目说明 |
| [README-TCP.md](./README-TCP.md) | TCP 模式指南 |
| [TEST-RESULTS.md](./TEST-RESULTS.md) | 测试报告 |
| [TEST-GUIDE.md](./TEST-GUIDE.md) | 测试指南 |
| [DEMO-SLIDES.md](./DEMO-SLIDES.md) | 演示文稿 |
| [DEMO-SCRIPT.md](./DEMO-SCRIPT.md) | 演示脚本 |

---

## 🎯 演示流程（15 分钟）

| 时间 | 内容 | Slide |
|------|------|-------|
| 2 min | 开场 + 问题动机 | 1-2 |
| 3 min | 架构设计 + TCP 握手 | 3-4 |
| 8 min | 功能演示（双终端 + 集成） | 5-8 |
| 2 min | 测试结果 + 部署 | 7-9 |
| 3 min | 总结 + Q&A | 10-12 |

---

## 💡 演示技巧

### 成功要点

1. **提前准备**: Redis 运行、代码编译、终端就绪
2. **节奏控制**: 不要急，给观众时间看日志
3. **关键解释**: 握手日志、seq/ack、会话复用

### 应对意外

- 演示失败 → 使用录屏备份
- 环境问题 → 展示静态截图
- 时间不够 → 跳过部分演示，直接看结果

---

## 📞 联系信息

**项目位置**: `/home/openclaw/.openclaw/workspace/redis-tcp-channel`  
**演示者**: GWork 👀  
**状态**: ✅ 生产就绪

---

*快速参考卡 v1.0.0 | 2026-03-12*
