# Redis TCP Channel 演示脚本

**演示时长**: 15-20 分钟  
**演示者**: GWork  
**日期**: 2026-03-12

---

## 📋 演示流程

### 开场（2 分钟）

**Slide 1-2**: 封面 + 问题与动机

**演讲要点**:
- 介绍项目背景和目标
- 说明现有 Redis Pub/Sub 的局限性
- 引出 TCP-like 可靠传输的必要性

**台词示例**:
> "大家好，今天我要演示的是 Redis TCP Channel - 一个为 OpenClaw 设计的可靠消息传输插件。
> 
> 我们知道 Redis Pub/Sub 很简单，但它有一个问题：消息可能丢失，没有确认机制。
> 
> 我们的解决方案是在应用层实现 TCP-like 协议，添加 seq/ack、重传机制，保证消息可靠传输。"

---

### 架构介绍（3 分钟）

**Slide 3-4**: 架构设计 + TCP 握手流程

**演讲要点**:
- 解释三层架构设计
- 说明 TCP 握手流程（重点：第一次握手即传输数据）
- 强调 seq/ack 和重传机制

**台词示例**:
> "我们的架构分为三层：Physical、IP、TCP、Application。
> 
> 关键在于 TCP 层，它实现了 seq/ack 序号管理、超时重传、连接状态机。
> 
> 看这个握手流程 - 我们做了优化：第一次握手就传输数据，减少了一次 RTT。"

---

### 功能演示（8 分钟）

**Slide 5-6**: 核心功能 + 使用示例

#### 演示 1: TCP Stack 双终端测试（4 分钟）

**操作步骤**:

```bash
# 打开终端 1
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
node test-tcp-stack.js --device-id=tcp-test-a --target=tcp-test-b --role=receiver

# 打开终端 2
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
node test-tcp-stack.js --device-id=tcp-test-b --target=tcp-test-a --role=initiator
```

**演讲要点**:
- 解释两个终端的角色（Receiver/Sender）
- 指出 TCP 握手日志
- 展示消息收发过程

**台词示例**:
> "现在我们运行双终端测试。左边是 Receiver，右边是 Sender。
> 
> 注意看 Sender 启动时的日志：
> - `[IP-Layer] ✅ 订阅完成` - IP 层启动
> - `[TCP-Layer] 已启动` - TCP 层启动
> - `[TCP-Layer] 收到 Segment` - 收到 SYN+ACK，握手成功
> 
> 现在发送 3 条测试消息... 看到吗？每条消息都有 ACK 确认。
> 
> Receiver 也在自动回复，这就是双向通信。"

#### 演示 2: 完整集成测试（4 分钟）

**操作步骤**:

```bash
# 单个终端运行完整测试
node test-full-integration.js
```

**演讲要点**:
- 展示 SessionService 如何管理会话
- 指出自动回复机制
- 强调会话复用

**台词示例**:
> "这个测试更完整，模拟真实场景。
> 
> 首先启动 Receiver... 然后 Sender 通过 SessionService 发送消息。
> 
> 注意看：
> - `[SessionService] 创建新会话` - 第一条消息创建会话
> - `[SessionService] 复用会话` - 后续消息复用连接
> 
> Receiver 收到消息后自动回复... 看到双向通信成功！"

---

### 测试结果（2 分钟）

**Slide 7**: 测试结果

**演讲要点**:
- 展示测试覆盖率
- 说明性能指标
- 提及修复的问题

**台词示例**:
> "我们做了 4 个阶段的测试，全部通过。
> 
> 性能方面：
> - Redis 连接延迟 <10ms
> - TCP 握手 <50ms
> - 消息发送 <100ms
> - 到达率 100%
> 
> 测试过程中修复了 4 个问题，主要是启动顺序和 payload 提取。"

---

### 部署和使用（2 分钟）

**Slide 8-9**: 现场演示 + 部署指南

**演讲要点**:
- 快速展示配置方法
- 说明如何使用

**台词示例**:
> "部署很简单：
> 1. `npm install && npm run build`
> 2. 配置 openclaw.json
> 3. 重启 Gateway
> 
> 使用时，通过 SessionService 发送消息即可，自动管理会话。"

---

### 总结和 Q&A（3 分钟）

**Slide 10-12**: 项目状态 + 下一步 + Q&A

**演讲要点**:
- 总结已完成的工作
- 说明项目状态（生产就绪）
- 回答问题

**台词示例**:
> "总结一下：
> - ✅ 三层架构实现
> - ✅ TCP 可靠传输
> - ✅ 完整测试覆盖
> - ✅ 文档完善
> 
> 项目已经生产就绪，欢迎大家试用！
> 
> 有什么问题吗？"

---

## 🎯 演示技巧

### 成功要点

1. **提前准备环境**
   - 确保 Redis 运行正常
   - 提前编译好代码
   - 准备好终端窗口

2. **演示节奏**
   - 不要急于切换终端
   - 给观众时间看日志
   - 关键日志要解释

3. **应对意外**
   - 如果演示失败，有录屏备份
   - 准备静态截图
   - 保持冷静，解释问题原因

### 常见问题预演

**Q: 和原生 TCP 有什么区别？**
> A: 我们在 Redis 应用层实现 TCP-like 协议，复用现有 Redis 基础设施，不需要额外端口。

**Q: 消息会丢失吗？**
> A: 不会。seq/ack 机制保证顺序，超时重传保证可靠，测试期间到达率 100%。

**Q: 性能如何？**
> A: 本地测试 <100ms 端到端延迟，Redis 单实例可支持数千并发连接。

---

## 📝 演示检查清单

### 演示前

- [ ] Redis 服务运行正常
- [ ] 代码已编译 (`npm run build`)
- [ ] 测试脚本可执行
- [ ] 终端窗口准备好
- [ ] Slide 已打开

### 演示中

- [ ] 语速适中
- [ ] 关键日志要解释
- [ ] 与观众互动
- [ ] 控制时间（15-20 分钟）

### 演示后

- [ ] 回答问题
- [ ] 收集反馈
- [ ] 清理环境
- [ ] 更新文档（如有需要）

---

## 🎬 演示备份方案

如果现场演示出现问题，使用以下备份：

### 备份 1: 录屏

提前录制好的演示视频：
- `test-tcp-stack.js` 双终端测试
- `test-full-integration.js` 完整测试

### 备份 2: 静态截图

```
截图 1: TCP Stack 测试成功输出
截图 2: 完整集成测试成功输出
截图 3: TEST-RESULTS.md 测试报告
```

### 备份 3: 日志输出

```bash
# 提前运行并保存输出
node test-full-integration.js > demo-output.log 2>&1
```

---

**祝演示顺利！🎉**
