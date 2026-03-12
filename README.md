## 🚀 Redis TCP Channel - OpenClaw Plugin

**可靠的 Redis 消息传输插件，基于 TCP-like 协议实现 seq/ack、重传机制**

```shell
# 发送消息到 Redis
redis-cli -h 127.0.0.1 -p 6379 PUBLISH "openclaw:device:node-sub-1" \
  '{"senderId":"test","text":"你好，我是 cli"}'
```

![openclaw-redis-channel](./example/example-chat.png)

通过 Redis Pub/Sub 机制实现 OpenClaw 自定义消息收发的 Channel 插件，支持 **TCP 可靠传输**（seq/ack、重传、会话管理）。

### 📋 快速开始

#### 1. 安装依赖

```bash
npm install
```

#### 2. 编译插件

```bash
npm run build
```

**输出**: `dist/` 目录包含编译后的 JavaScript 文件

#### 3. 测试插件

```bash
# Redis 连接测试
node test-redis-connection.js

# TCP Stack 测试（双终端）
# 终端 1: node test-tcp-stack.js --role=receiver
# 终端 2: node test-tcp-stack.js --role=initiator

# 完整集成测试
node test-full-integration.js

# session-send 模拟测试
node test-session-send-full.js
```

**测试结果**: 查看 [TEST-RESULTS.md](./TEST-RESULTS.md)

#### 4. 部署到 OpenClaw

openclaw 支持以下方式安装 plugins: [plugin#cli](https://docs.openclaw.ai/zh-CN/tools/plugin#cli)
```shell
openclaw plugins install <path>                 # copy a local file/dir into ~/.openclaw/extensions/<id>
openclaw plugins install ./extensions/voice-call # relative path ok
openclaw plugins install ./plugin.tgz           # install from a local tarball
openclaw plugins install ./plugin.zip           # install from a local zip
openclaw plugins install -l ./extensions/voice-call # link (no copy) for dev
openclaw plugins install @openclaw/voice-call # install from npm
```

##### 方式一： npm打包
```shell
npm pack # 将生成 .tgz 产物 /HTMLgtMK-redis-channel-1.1.3.tgz
```

openclaw 安装 plugins:
```
openclaw plugins install ./HTMLgtMK-redis-channel-1.1.3.tgz
```

##### 方式二：本地目录安装

将以下文件复制到目录：
- `dist/`
- `openclaw.plugin.json`
- `package.json`

openclaw 安装：
```shell
openclaw plugins install ./
```


#### 4. 配置 OpenClaw

在 `~/.openclaw/openclaw.json` 中添加插件配置：

```json
{
  "plugins": {
    "allow": ["redis-tcp-channel"],
    "installs": {
      "redis-tcp-channel": {
        "source": "path",
        "installPath": "/path/to/redis-tcp-channel"
      }
    }
  },
  "channels": {
    "redis-tcp-channel": {
      "enabled": true,
      "accounts": {
        "default": {
          "enabled": true,
          "redisUrl": "redis://localhost:6379",
          "deviceId": "node-local",
          "deviceName": "本地节点",
          "targetSession": "agent:main:main"
        }
      }
    }
  }
}
```

**配置说明**:
- `redisUrl`: Redis 连接地址
- `deviceId`: 当前设备唯一标识
- `targetSession`: 消息转发到的 Agent 会话
        }
      }
    }
  }
}
```

### 📋 配置参数

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| `redisUrl` | string | ✅ | Redis 连接 URL | - |
| `deviceId` | string | ✅ | 设备唯一标识符 | - |
| `deviceName` | string | ❌ | 设备显示名称 | `deviceId` |
| `heartbeatInterval` | number | ❌ | 心跳间隔（毫秒） | 20000 |
| `subscribeChannel` | string | ❌ | 订阅的入站消息频道 | `openclaw:device:<deviceId>` |
| `publishChannel` | string | ❌ | 发布出站消息频道 | `openclaw:device:<targetDeviceId>` |
| `senderNamePrefix` | string | ❌ | 发送者名称前缀 | `""` |
| `messageFormat` | `"json"` \| `"text"` | ❌ | 消息格式 | `"json"` |
| `targetSession` | string | ❌ | 目标会话ID | `"agent:main:main"` |
| `autoExecute` | boolean | ❌ | 是否自动执行命令 | `false` |
| `showSenderPrefix` | boolean | ❌ | 是否显示发送者前缀 | `true` |

### 🧪 测试

#### 发送消息（模拟外部系统 → OpenClaw）

```bash
redis-cli -h 127.0.0.1 -p 6379 PUBLISH "openclaw:device:node-sub-1" '{"senderId":"test","text":"你好， 我是cli"}'
```


### 📋 消息格式

#### 入站消息（外部 → OpenClaw）

```json
{
  "senderId": "user123",
  "senderName": "张三",
  "text": "你好！",
  "timestamp": 1709567890000,
  "isGroup": false,
  "groupId": null,
  "metadata": {}
}
```

#### 出站消息（OpenClaw → 外部）

```json
{
  "from": "openclaw",
  "to": "user123",
  "text": "你好，我是 AI 助手！",
  "timestamp": 1709567895000,
  "messageId": "uuid-here"
}
```

### 🔌 多账号配置示例

```json
{
  "channels": {
    "redis-channel": {
      "accounts": {
        "local": {
          "enabled": true,
          "redisUrl": "redis://localhost:6379",
          "deviceId": "node-local",
          "deviceName": "本地节点"
        },
        "remote": {
          "enabled": true,
          "redisUrl": "redis://remote-server:6379",
          "deviceId": "node-remote",
          "deviceName": "远程节点"
        }
      }
    }
  }
}
```

### 📁 源码结构

```
src/
├── index.ts                 # 主入口文件
└── lib/
    ├── types.ts             # 类型定义
    ├── redis-client.ts      # Redis 客户端管理
    ├── message-handler.ts   # 消息处理逻辑
    ├── message-sender.ts    # 消息发送逻辑
    ├── heartbeat.ts         # 心跳功能
    ├── logger.ts            # 统一日志系统
    └── message-dispatcher.ts # 消息分发逻辑
```

### 📝 变更日志

#### 最新版本 (2026-03-06)

**功能增强**
- 新增统一的日志系统 (`src/lib/logger.ts`)，桥接到 OpenClaw 日志
- 实现消息路由到目标会话 (`targetSession` 配置)
- 支持自动执行命令 (`autoExecute` 配置)
- 实现消息分发逻辑到独立文件 (`src/lib/message-dispatcher.ts`)
- 使用官方 OpenClaw Plugin SDK 类型

**架构改进**
- 模块化设计：将功能拆分为独立模块
- 统一日志接口：所有组件使用统一的日志系统
- 消息处理分离：入站消息处理与分发逻辑分离

#### v1.1.2 (2026-03-05)

**心跳功能**
- 新增 `heartbeatInterval` 配置项（默认 20000ms）
- 新增 `src/lib/heartbeat.ts` 模块
- 定时写入 `devices:<deviceId>:heartbeat` 到 Redis（TTL 60 秒）
- 支持优雅关闭时停止心跳

#### v1.1.1 (2026-03-05)

**API 适配更新**
- `gateway.start` → `gateway.startAccount`，使用新的 `params` 参数结构
- 新增 `StartAccountParams` 接口：`cfg`, `accountId`, `account`, `abortSignal`, `log`
- 日志调用改为可选链 `log?.info?.()` 并添加 `[accountId]` 前缀
- 新增 `abortSignal` 事件处理，支持 OpenClaw 优雅关闭机制
- 新增 `config.isEnabled` 和 `config.isConfigured` 方法
- 新增 `configSchema` 定义

**功能增强**
- 收到消息时自动转发到飞书通知（使用 OpenClaw CLI）

**类型定义更新**
- `src/types/openclaw.d.ts`: 新增 `StartAccountParams` 接口
- `GatewayAdapter`: 同时支持 `start` 和 `startAccount` 方法
- `ChannelPluginConfig`: 新增可选的 `isEnabled` 和 `isConfigured` 方法

#### v1.1.0 (2026-03-05)

**新增配置参数**
- 新增 `deviceId` (必填): 设备唯一标识符
- 新增 `deviceName` (可选): 设备显示名称

**默认频道规则变更**
- `subscribeChannel`: 未指定时默认为 `openclaw:device:<deviceId>`
- `publishChannel`: 未指定时默认为 `openclaw:device:<targetDeviceId>`

---

*最后更新：2026-03-06*