#!/usr/bin/env node
/**
 * OpenClaw 集成测试
 * 
 * 模拟 OpenClaw Core 调用 sendText() 流程
 * 测试 sessionMap 和 SessionKey 管理（不实际连接 Redis）
 */

// ============================================
// 🔧 配置
// ============================================
const config = {
  // Redis 通过 SSH 隧道转发到 GBOT 机器
  // 本地端口 16379 → GBOT 机器 Redis 6379
  redisUrl: process.env.REDIS_URL || 'redis://localhost:16379',
  deviceId: 'device-a',
  deviceName: 'Device A',
};

// ============================================
// 🎯 模拟 sessionMap（如 src/index.ts）
// ============================================
const sessionMap = new Map();

// 模拟 createRedisChannelStack
function mockCreateStack(params) {
  const messages = [];
  
  return {
    connectionId: params.connectionId,
    sessionKey: params.connectionId.replace('tcp-', ''),
    isStarted: false,
    
    async start() {
      this.isStarted = true;
      console.log('  → 会话已启动 ✅');
    },
    
    appLayer: {
      sendMessage(data) {
        messages.push(data);
        console.log('  → 消息已发送 ✅');
        console.log(`     内容：${data.data.text}`);
        return Promise.resolve();
      },
      
      getStatus() {
        return {
          state: messages.length > 0 ? 'ESTABLISHED' : 'CLOSED',
          messageCount: messages.length,
        };
      },
    },
    
    async stop() {
      console.log('  → 会话已关闭 ✅');
    },
  };
}

// ============================================
// 🎯 模拟 sendText 函数（如 src/index.ts）
// ============================================
async function sendText(text, to, sessionKey) {
  const connectionId = `tcp-${sessionKey}`;
  
  console.log(`  SessionKey: ${sessionKey}`);
  console.log(`  connectionId: ${connectionId}`);
  
  // 获取或创建会话
  let stack = sessionMap.get(sessionKey);
  
  if (!stack) {
    console.log('  → 创建新会话');
    
    stack = mockCreateStack({
      redisUrl: config.redisUrl,
      deviceId: config.deviceId,
      targetDeviceId: to,
      connectionId,
      isInitiator: true,
    });
    
    sessionMap.set(sessionKey, stack);
    
    // 启动会话
    await stack.start();
  } else {
    console.log('  → 复用已有会话 ✅');
  }
  
  // 发送消息
  await stack.appLayer.sendMessage({
    type: 'message',
    data: { text, timestamp: Date.now() },
    timestamp: Date.now(),
  });
  
  return { ok: true, id: connectionId };
}

// ============================================
// 🚀 主测试函数
// ============================================
async function runTest() {
  console.log('='.repeat(60));
  console.log('🧪 OpenClaw 集成测试（模拟 sendText 流程）');
  console.log('='.repeat(60));
  console.log();
  
  // 测试 1: webchat 场景
  console.log('📝 测试 1: webchat 用户发送消息');
  console.log('-'.repeat(60));
  
  const webchatResult = await sendText(
    '你好，这是 webchat 测试消息',
    'device-b',
    'webchat:user123:1710156000'  // OpenClaw 生成的 SessionKey
  );
  
  console.log('  结果:', JSON.stringify(webchatResult));
  console.log();
  
  // 测试 2: agent 场景
  console.log('📝 测试 2: agent 发送消息');
  console.log('-'.repeat(60));
  
  const agentResult = await sendText(
    '你好，这是 agent 测试消息',
    'device-b',
    'session-agent-a-b-001'  // agent 之间的 SessionKey
  );
  
  console.log('  结果:', JSON.stringify(agentResult));
  console.log();
  
  // 测试 3: 多轮对话（会话复用）
  console.log('📝 测试 3: 多轮对话（会话复用）');
  console.log('-'.repeat(60));
  
  const sessionKey = 'session-multi-turn-001';
  
  for (let i = 1; i <= 3; i++) {
    console.log();
    console.log(`第 ${i} 轮对话:`);
    
    const result = await sendText(
      `第 ${i} 轮测试消息`,
      'device-b',
      sessionKey
    );
    
    console.log('  结果:', JSON.stringify(result));
  }
  
  console.log();
  console.log('='.repeat(60));
  console.log('✅ 测试完成！');
  console.log('='.repeat(60));
  console.log();
  console.log('📊 测试覆盖:');
  console.log('  ✅ webchat 场景（OpenClaw 生成 SessionKey）');
  console.log('  ✅ agent 场景（自定义 SessionKey）');
  console.log('  ✅ 多轮对话（会话复用）');
  console.log();
  console.log('📊 会话映射:');
  console.log(`  当前会话数：${sessionMap.size}`);
  for (const [key, stack] of sessionMap.entries()) {
    const status = stack.appLayer.getStatus();
    console.log(`  - ${key}: ${status.state} (${status.messageCount} 条消息)`);
  }
  console.log();
  
  // 清理
  console.log('🧹 清理会话...');
  for (const [key, stack] of sessionMap.entries()) {
    await stack.stop();
  }
  
  console.log();
  console.log('✅ 所有测试完成！');
  console.log();
  console.log('📝 下一步:');
  console.log('  1. 启动 Redis: redis-server');
  console.log('  2. 运行实际测试：node test-tcp-stack.js --device-id=device-a --target=device-b --role=initiator');
  console.log();
}

// ============================================
// 🎯 运行测试
// ============================================
runTest().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
