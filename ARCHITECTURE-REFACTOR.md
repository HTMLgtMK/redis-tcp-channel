# 架构重构 - 清晰分层设计

## 📐 问题

**之前**: `src/index.ts` 的 `sendText` 直接操作 TCP 层，职责不清

```typescript
// ❌ 问题代码
sendText: async (ctx) => {
  // Plugin 层做了业务逻辑的事
  const stack = createRedisChannelStack({...});
  sessionMap.set(sessionKey, stack);
  await stack.start();
  await stack.appLayer.sendMessage(...);
}
```

## ✅ 重构后

### 四层架构

```
┌─────────────────────────────────────────────────┐
│  Plugin Layer (src/index.ts)                    │
│  - OpenClaw 插件接口                             │
│  - sendText() 调用业务逻辑层                     │
│  - 职责：协议转换、参数验证                       │
├─────────────────────────────────────────────────┤
│  Business Layer (src/business/)                 │
│  - SessionService (会话管理)                    │
│  - 职责：会话管理、连接管理、业务逻辑             │
├─────────────────────────────────────────────────┤
│  TCP Layer (src/modules/tcp-layer/)             │
│  - 职责：seq/ack、重传、可靠传输                 │
├─────────────────────────────────────────────────┤
│  IP Layer (src/modules/ip-layer/)               │
│  - 职责：Redis Pub/Sub、装包/拆包                │
└─────────────────────────────────────────────────┘
```

## 📁 新增文件

### `src/business/session-service.ts`

**职责**:
- 管理 TCP 会话（创建、复用、清理）
- 发送消息
- 会话超时清理（5 分钟无活动）

**接口**:
```typescript
class SessionService {
  // 发送消息
  sendMessage(
    account: RedisChannelAccountConfig,
    targetDeviceId: string,
    sessionKey: string,
    text: string
  ): Promise<{ ok: boolean; id?: string; error?: string }>
  
  // 关闭会话
  closeSession(sessionKey: string): Promise<void>
  
  // 获取统计
  getStats(): { totalSessions: number; sessions: [...] }
  
  // 停止服务
  stop(): void
}
```

## 🔄 数据流

### 发送流程（重构后）

```
webchat/agent
    ↓
OpenClaw Core → sendText(ctx)
    ↓
Plugin Layer (src/index.ts)
    ↓ 提取参数
    ↓
Business Layer (SessionService)
    ↓ sessionMap.get(sessionKey)
    ├─ 无 → 创建 RedisChannelStack → TCP → IP → Redis
    └─ 有 → 复用 → TCP → IP → Redis
```

### 代码对比

**之前** (src/index.ts):
```typescript
// ❌ Plugin 层做业务逻辑
const stack = createRedisChannelStack({...});
sessionMap.set(sessionKey, stack);
await stack.start();
await stack.appLayer.sendMessage(appMessage);
setTimeout(() => {
  stack.stop();
  sessionMap.delete(sessionKey);
}, keepAliveMs);
```

**之后** (src/index.ts):
```typescript
// ✅ Plugin 层只调用业务逻辑
const result = await sessionService.sendMessage(
  account,
  to,
  sessionKey,
  text
);
```

**业务逻辑层** (src/business/session-service.ts):
```typescript
// ✅ 业务逻辑集中在这一层
async sendMessage(account, targetDeviceId, sessionKey, text) {
  const session = this.getOrCreateSession(...);
  await session.stack.appLayer.sendMessage(appMessage);
  session.lastActivity = Date.now();
  session.messageCount++;
  return { ok: true, id: `tcp-${sessionKey}` };
}
```

## 🎯 各层职责

### Plugin Layer (src/index.ts)

**职责**:
- ✅ OpenClaw 插件注册
- ✅ 协议转换（OpenClaw → 业务逻辑）
- ✅ 参数验证
- ❌ 不管理会话
- ❌ 不直接操作 TCP 层

**示例**:
```typescript
sendText: async (ctx) => {
  // 1. 提取参数
  const { text, to, accountId, cfg } = ctx;
  
  // 2. 获取账户配置
  const account = getAccount(accountId, cfg);
  
  // 3. 提取 SessionKey
  const sessionKey = ctx.SessionKey || `session-${Date.now()}`;
  
  // 4. 调用业务逻辑层
  return await sessionService.sendMessage(
    account,
    to,
    sessionKey,
    text
  );
}
```

### Business Layer (src/business/)

**职责**:
- ✅ 会话管理（sessionMap）
- ✅ TCP 连接管理
- ✅ 会话超时清理
- ✅ 业务逻辑
- ❌ 不关心 OpenClaw 细节
- ❌ 不直接操作 Redis

**示例**:
```typescript
class SessionService {
  private sessions: Map<string, SessionInfo> = new Map();
  
  async sendMessage(account, targetDeviceId, sessionKey, text) {
    const session = this.getOrCreateSession(...);
    await session.stack.appLayer.sendMessage(appMessage);
    session.lastActivity = Date.now();
    return { ok: true, id: `tcp-${sessionKey}` };
  }
  
  private getOrCreateSession(...) {
    // 会话管理逻辑
  }
}
```

### TCP Layer (src/modules/tcp-layer/)

**职责**:
- ✅ seq/ack 机制
- ✅ 超时重传
- ✅ 连接状态管理
- ❌ 不管理多个会话
- ❌ 不关心业务逻辑

### IP Layer (src/modules/ip-layer/)

**职责**:
- ✅ Redis Pub/Sub
- ✅ 装包/拆包
- ❌ 不关心 TCP 细节

## 📊 优势

### 1. 职责清晰

| 层 | 职责 | 依赖 |
|------|------|------|
| Plugin | OpenClaw 接口 | Business |
| Business | 会话管理 | TCP |
| TCP | 可靠传输 | IP |
| IP | Redis 通信 | 无 |

### 2. 易于测试

```typescript
// 测试业务逻辑层（不依赖 OpenClaw）
const service = new SessionService();
await service.sendMessage(account, 'device-b', 'session-001', '你好');

// 测试 Plugin 层（mock 业务逻辑）
const mockService = { sendMessage: jest.fn() };
// ...
```

### 3. 易于维护

- 修改会话管理逻辑 → 只改 Business Layer
- 修改 OpenClaw 接口 → 只改 Plugin Layer
- 修改 TCP 协议 → 只改 TCP Layer

### 4. 可复用

```typescript
// Business Layer 可以在其他地方复用
import { getSessionService } from './business/session-service';

// 不依赖 OpenClaw 的场景
const service = getSessionService();
await service.sendMessage(...);
```

## 🧪 测试

### 业务逻辑层测试

```typescript
// test-business.test.ts
import { SessionService } from './business/session-service';

describe('SessionService', () => {
  it('should create new session', async () => {
    const service = new SessionService();
    const result = await service.sendMessage(
      account,
      'device-b',
      'session-001',
      '你好'
    );
    expect(result.ok).toBe(true);
  });
  
  it('should reuse existing session', async () => {
    const service = new SessionService();
    await service.sendMessage(..., 'session-001', ...);
    await service.sendMessage(..., 'session-001', ...);
    expect(service.getStats().totalSessions).toBe(1);
  });
});
```

### Plugin 层测试

```typescript
// test-plugin.test.ts
import plugin from './index';

describe('Plugin', () => {
  it('should call business layer', async () => {
    const result = await plugin.outbound.sendText({
      text: '你好',
      to: 'device-b',
      SessionKey: 'session-001',
      accountId: 'default',
      cfg: {...},
    });
    expect(result.ok).toBe(true);
  });
});
```

## 📝 总结

**重构前**:
- ❌ Plugin 层做业务逻辑
- ❌ 职责不清
- ❌ 难以测试

**重构后**:
- ✅ 四层清晰分离
- ✅ 职责明确
- ✅ 易于测试和维护
- ✅ 业务逻辑可复用

---

**版本**: 3.0.4  
**日期**: 2026-03-11  
**状态**: ✅ 重构完成
