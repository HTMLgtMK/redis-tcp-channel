#!/usr/bin/env node
/**
 * Redis TCP Channel 测试脚本
 * 
 * 测试三层架构和 TCP 协议
 * 
 * 用法:
 *   node test/test-tcp-stack.js --device-id=tcp-test-a --target=tcp-test-b --role=receiver
 *   node test/test-tcp-stack.js --device-id=tcp-test-b --target=tcp-test-a --role=initiator
 */

const { createRedisChannelStack } = require('../dist/modules');

// ============================================
// 🔧 命令行参数解析
// ============================================
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  
  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) {
      params[key.slice(2)] = value;
    }
  }
  
  return params;
}

// ============================================
// 🚀 主函数
// ============================================
async function main() {
  const params = parseArgs();
  
  const deviceId = params['device-id'] || 'tcp-test-a';
  const target = params['target'] || 'tcp-test-b';
  const role = params['role'] || 'receiver';
  const redisPassword = process.env.REDIS_PASSWORD || '${REDIS_PASSWORD:-redis123}';
  const redisUrl = params['redis-url'] || `redis://:${redisPassword}@localhost:16379`;
  
  console.log('='.repeat(60));
  console.log('🧪 Redis TCP Channel 测试');
  console.log('='.repeat(60));
  console.log('Device:', deviceId);
  console.log('Target:', target);
  console.log('Role:', role);
  console.log('Redis:', redisUrl.replace(/:[^:]+@/, ':***@'));
  console.log('='.repeat(60));
  console.log();
  
  // 创建 Stack
  const stack = createRedisChannelStack({
    redisUrl,
    deviceId,
    targetDeviceId: target,
    connectionId: 'tcp-test-session-001',
    isInitiator: role === 'initiator',
    initialMessage: role === 'initiator' ? {
      type: 'greeting',
      data: { message: `Hello from ${deviceId}!` },
      timestamp: Date.now(),
    } : undefined,
  });
  
  // 注册消息回调
  stack.onMessage((appMessage) => {
    console.log();
    console.log('📥 收到消息:');
    console.log('  Type:', appMessage.type);
    console.log('  Data:', JSON.stringify(appMessage.data));
    console.log('  Timestamp:', new Date(appMessage.timestamp).toLocaleTimeString());
    
    // 自动回复（如果不是握手消息）
    if (appMessage.type !== 'greeting') {
      console.log();
      console.log('📤 自动回复...');
      stack.sendMessage({
        type: 'response',
        data: { 
          message: `收到！来自 ${deviceId}`,
          replyTo: appMessage.data.message || appMessage.data.text,
        },
        timestamp: Date.now(),
      }).catch(console.error);
    }
  });
  
  // 注册断联回调
  stack.onDisconnect(() => {
    console.log();
    console.log('🔴 Redis 连接断开');
  });
  
  // 启动
  console.log('⏳ 启动中...');
  await stack.start();
  console.log('✅ 已启动');
  
  if (role === 'initiator') {
    // 发起方：发送测试消息
    console.log();
    console.log('⏳ 等待 2 秒后发送测试消息...');
    await new Promise(r => setTimeout(r, 2000));
    
    console.log();
    console.log('📤 发送第 1 条消息...');
    await stack.sendMessage({
      type: 'message',
      data: { text: '测试消息 1', sequence: 1 },
      timestamp: Date.now(),
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    console.log();
    console.log('📤 发送第 2 条消息...');
    await stack.sendMessage({
      type: 'message',
      data: { text: '测试消息 2', sequence: 2 },
      timestamp: Date.now(),
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    console.log();
    console.log('📤 发送第 3 条消息...');
    await stack.sendMessage({
      type: 'message',
      data: { text: '测试消息 3', sequence: 3 },
      timestamp: Date.now(),
    });
    
    // 保持运行一段时间后关闭
    console.log();
    console.log('⏱️  运行 10 秒后关闭...');
    await new Promise(r => setTimeout(r, 10000));
    
    console.log();
    console.log('🛑 关闭连接...');
    await stack.stop();
    
    console.log();
    console.log('✅ 测试完成!');
    process.exit(0);
    
  } else {
    // 接收方：等待消息
    console.log();
    console.log('⏳ 等待对方发送消息... (Ctrl+C 退出)');
    console.log();
    console.log('提示：在另一个终端运行:');
    console.log(`  node test/test-tcp-stack.js --device-id=${target} --target=${deviceId} --role=initiator`);
    console.log();
  }
}

// ============================================
// 🎯 运行
// ============================================
main().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
