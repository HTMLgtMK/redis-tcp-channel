# Redis TCP Channel 演示手册

**版本**: 2.0.0  
**日期**: 2026-03-12  
**时长**: 15 分钟

---

## 📋 演示前检查

### 1. 环境准备

```bash
# 检查 Redis 是否运行
redis-cli -h localhost -p 16379 ping
# 应返回：PONG

# 检查 Node.js 版本
node --version
# 应 >= 18.0.0

# 检查依赖是否安装
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
npm ls ioredis
# 应显示已安装
```

### 2. 编译项目

```bash
npm run build
# 应显示：Process exited with code 0
```

### 3. 预运行测试

```bash
# 快速验证
node test-physical-layer.js
# 应显示：✅ 所有测试完成！
```

---

## 🎬 演示流程

### 第一部分：架构介绍（3 分钟）

**展示 README-FINAL.md**：

```bash
cat README-FINAL.md | head -60
```

**讲解要点**：
1. 四层架构（Physical → IP → TCP → Application）
2. 连接池设计（直接管理 TCPLayer）
3. TCP 握手流程（SYN → SYN+ACK → ACK）

---

### 第二部分：现场演示（8 分钟）

#### 演示 1：双终端测试

**打开两个终端窗口**：

终端 1（Receiver）：
```bash
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
node test-tcp-stack.js --device-id=demo-receiver --target=demo-sender --role=receiver
```

终端 2（Sender）：
```bash
cd /home/openclaw/.openclaw/workspace/redis-tcp-channel
node test-tcp-stack.js --device-id=demo-sender --target=demo-receiver --role=initiator
```

**讲解要点**：
- 观察 SYN/SYN+ACK/ACK 握手日志
- 3 条测试消息全部到达
- 自动回复机制

---

#### 演示 2：完整集成测试

**单个终端运行**：
```bash
node test-full-integration.js
```

**预期输出**：
```
📊 验证结果
----------------------------------------
Receiver 收到 4 条消息
Sender 收到 4 条回复

🎉 验证通过:
  ✅ Receiver 收到 4 条消息 (期望>=3)
  ✅ Sender 收到 4 条回复 (期望>=3)
```

**讲解要点**：
- 双向通信完整流程
- 连接池正常工作
- 消息不丢失

---

#### 演示 3：代码结构

```bash
# 展示目录结构
tree -L 2 src/modules/

# 展示核心代码（可选）
head -50 src/modules/physical-layer.ts
head -50 src/modules/tcp-layer/connection-pool.ts
```

**讲解要点**：
- 架构简洁（无多余包装层）
- 代码清晰（职责分明）

---

### 第三部分：Q&A（4 分钟）

**常见问题准备**：

1. **为什么删除 TcpConnection？**
   - 状态不同步问题
   - 减少代码复杂度

2. **如何保证可靠性？**
   - seq/ack 序号管理
   - 超时重传机制
   - 连接状态机

3. **性能如何？**
   - 本地测试 <100ms
   - 连接池复用
   - ioredis 高性能

4. **与 HTTP 对比？**
   - 类似 HTTP Keep-Alive
   - 应用层实现 TCP 语义
   - 基于 Redis Pub/Sub

---

## 🚨 应急方案

### 如果演示失败

**方案 A：使用录屏**
```bash
# 提前录制的演示视频
ls -la demo-recordings/
```

**方案 B：查看测试日志**
```bash
# 查看之前的测试输出
cat test-logs/full-integration.log
```

**方案 C：展示架构图**
```bash
# 展示架构图文档
cat README-FINAL.md
```

---

## 📝 演示后清理

```bash
# 清理测试进程
pkill -f "test-tcp-stack.js"
pkill -f "test-full-integration.js"

# 清理日志（可选）
rm -f test-logs/*.log
```

---

## ✅ 演示成功标准

- [ ] 双终端测试通过
- [ ] 完整集成测试通过
- [ ] Q&A 回答清晰
- [ ] 时间控制在 15 分钟内

---

**祝演示顺利！** 🎉
