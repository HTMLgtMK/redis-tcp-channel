# Redis TCP Channel 测试指南

## 📋 测试准备

### 1. 确保 Redis 可用

Redis 在 GBOT 机器上，通过 SSH 隧道转发：

```bash
# 检查 SSH 隧道
ps aux | grep ssh

# 应该看到类似：
# ssh -L 16379:127.0.0.1:6379 root@106.14.245.237

# 测试 Redis 连接
redis-cli -h localhost -p 16379 -a Redis@Parent2026! ping
# 应该返回：PONG
```

### 2. 安装新插件

```bash
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
npm install
npm run build
```

### 3. 配置 OpenClaw

在 `~/.openclaw/openclaw.json` 中添加新插件配置：

```json
{
  "channels": {
    "redis-tcp-channel": {
      "enabled": true,
      "accounts": {
        "default": {
          "enabled": true,
          "redisUrl": "redis://:Redis@Parent2026!@localhost:16379",
          "deviceId": "device-a",
          "deviceName": "Device A (TCP)",
          "targetSession": "agent:main:main"
        }
      }
    }
  },
  "plugins": {
    "installs": {
      "redis-tcp-channel": {
        "source": "local",
        "installPath": "/home/openclaw/.openclaw/workspace/redis-tcp-channel",
        "enabled": true
      }
    }
  }
}
```

重启 OpenClaw：

```bash
openclaw restart
```

---

## 🧪 测试方式

### 方式 1: 直接测试 Stack（不依赖 OpenClaw）

**终端 1（接收方）:**

```bash
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
node test/test-tcp-stack.js \
  --device-id=tcp-test-a \
  --target=tcp-test-b \
  --role=receiver
```

**终端 2（发起方）:**

```bash
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
node test/test-tcp-stack.js \
  --device-id=tcp-test-b \
  --target=tcp-test-a \
  --role=initiator
```

**预期输出:**

```
🧪 Redis TCP Channel 测试
============================================================
Device: tcp-test-b
Target: tcp-test-a
Role: initiator
Redis: redis://:***@localhost:16379
============================================================

⏳ 启动中...
✅ 已启动

⏳ 等待 2 秒后发送测试消息...

📤 发送第 1 条消息...

📥 收到消息:
  Type: response
  Data: {"message":"收到！来自 tcp-test-a"}
  Timestamp: 23:05:30

📤 发送第 2 条消息...

📥 收到消息:
  Type: response
  Data: {"message":"收到！来自 tcp-test-a"}
  Timestamp: 23:05:31

...

✅ 测试完成!
```

---

### 方式 2: 通过 OpenClaw session-send 测试

**前提**: OpenClaw 已安装并配置好新插件

```bash
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
node test/test-openclaw-send.js \
  --to=device-b \
  --message="Hello TCP Channel" \
  --channel=redis-tcp-channel
```

**预期输出:**

```
🧪 OpenClaw session-send 测试
============================================================
To: device-b
Message: Hello TCP Channel
Channel: redis-tcp-channel
============================================================

📤 执行命令: openclaw session-send --to=device-b --channel=redis-tcp-channel "Hello TCP Channel"

✅ 命令执行成功

stdout: Message sent successfully

✅ 测试完成!
```

---

### 方式 3: OpenClaw 命令行直接测试

```bash
# 发送消息
openclaw session-send \
  --to=device-b \
  --channel=redis-tcp-channel \
  "Hello from CLI"

# 查看日志
openclaw logs | grep redis-tcp-channel
```

---

## 📊 验证点

### ✅ Stack 层测试

- [ ] Stack 创建成功
- [ ] Stack.start() 启动订阅
- [ ] Stack.onMessage() 接收消息
- [ ] Stack.onDisconnect() 接收断联
- [ ] Stack.sendMessage() 发送消息
- [ ] Stack.stop() 停止订阅

### ✅ TCP 层测试

- [ ] SYN 握手成功
- [ ] SYN+ACK 响应
- [ ] DATA 消息发送
- [ ] ACK 确认
- [ ] seq/ack 正确递增
- [ ] 超时重传（可选）

### ✅ IP 层测试

- [ ] Redis 订阅成功
- [ ] Redis 发布成功
- [ ] 消息拆包正确
- [ ] 消息装包正确
- [ ] 断联检测

### ✅ 应用层测试

- [ ] 消息格式正确
- [ ] 回调触发正确
- [ ] 多轮对话保持

---

## 🐛 故障排除

### 问题 1: 连接失败

```bash
# 检查 Redis
redis-cli -h localhost -p 16379 -a Redis@Parent2026! ping

# 检查 SSH 隧道
ps aux | grep ssh

# 重启 SSH 隧道
pkill -f "ssh.*16379"
ssh -N -f -L 16379:127.0.0.1:6379 -i /tmp/openclaw-ssh/openclaw-ssh.pem \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  root@106.14.245.237
```

### 问题 2: 插件未加载

```bash
# 检查插件配置
openclaw config show | grep redis-tcp-channel

# 查看插件日志
openclaw logs | grep redis-tcp-channel

# 重新安装插件
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
npm install
npm run build
openclaw restart
```

### 问题 3: 消息未收到

```bash
# 检查频道名称
redis-cli -h localhost -p 16379 -a Redis@Parent2026! PUBSUB CHANNELS

# 应该看到：
# - openclaw:device:device-a
# - openclaw:device:device-b
# - openclaw:device:tcp-test-a
# - openclaw:device:tcp-test-b
```

---

## 📝 测试报告模板

```markdown
# Redis TCP Channel 测试报告

## 测试环境
- Redis: GBOT 机器 (106.14.245.237:6379)
- SSH 隧道：localhost:16379
- OpenClaw 版本：2026.3.2
- 插件版本：1.0.0

## 测试结果

### Stack 层
- [x] Stack 创建
- [x] Stack 启动
- [x] Stack 消息回调
- [x] Stack 断联回调
- [x] Stack 发送消息
- [x] Stack 停止

### TCP 层
- [x] SYN 握手
- [x] SYN+ACK 响应
- [x] DATA 消息
- [x] ACK 确认
- [x] seq/ack 递增

### IP 层
- [x] Redis 订阅
- [x] Redis 发布
- [x] 消息拆包
- [x] 消息装包

### 应用层
- [x] 消息格式
- [x] 回调触发
- [x] 多轮对话

## 问题与解决

### 问题 1: ...
**解决**: ...

### 问题 2: ...
**解决**: ...

## 结论

✅ 所有测试通过，插件工作正常
```

---

**版本**: 1.0.0  
**日期**: 2026-03-12  
**状态**: 🧪 测试中
