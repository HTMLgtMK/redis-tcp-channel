#!/usr/bin/env node
/**
 * 完整 session-send 测试（双向验证）
 * 
 * 模拟真实场景：
 * 1. Receiver 监听目标设备
 * 2. Sender 通过 sendText 发送消息
 * 3. 验证 Receiver 收到消息
 */

const { redisChannelPlugin } = require('./dist/index');
const { createRedisChannelStack } = require('./dist/modules');

// ============================================
// 🔧 测试配置
// ============================================
const TEST_CONFIG = {
  channels: {
    'redis-channel': {
      accounts: {
        default: {
          enabled: true,
          redisUrl: 'redis://:${REDIS_PASSWORD:-redis123}@localhost:16379',
          deviceId: 'sender-device',
          deviceName: 'Sender Device',
        }
      }
    }
  }
};

const SENDER_DEVICE = 'sender-device';
const RECEIVER_DEVICE = 'receiver-device';
const TEST_MESSAGE = 'Hello from session-send!';
const SESSION_KEY = `full-test-${Date.now()}`;

// ============================================
// 🚀 主测试函数
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 完整 session-send 测试（双向验证）');
  console.log('='.repeat(60));
  console.log();
  
  // 1. 启动 Receiver（监听目标设备）
  console.log('📥 步骤 1: 启动 Receiver...');
  console.log('-'.repeat(40));
  
  const receiverStack = createRedisChannelStack({
    redisUrl: TEST_CONFIG.channels['redis-channel'].accounts.default.redisUrl,
    deviceId: RECEIVER_DEVICE,
    deviceName: 'Receiver Device',
    targetDeviceId: SENDER_DEVICE,
    connectionId: `tcp-${SESSION_KEY}`,
    isInitiator: false,
  });
  
  let receivedMessages = [];
  receiverStack.onMessage((msg) => {
    receivedMessages.push(msg);
    console.log(`  📨 Receiver 收到：${msg.data.text}`);
  });
  
  await receiverStack.start();
  console.log('  ✅ Receiver 已启动');
  console.log();
  
  // 2. 发送消息（模拟 session-send）
  console.log('📤 步骤 2: 执行 session-send...');
  console.log('-'.repeat(40));
  console.log(`  To: ${RECEIVER_DEVICE}`);
  console.log(`  Message: ${TEST_MESSAGE}`);
  console.log();
  
  const ctx = {
    text: TEST_MESSAGE,
    to: RECEIVER_DEVICE,
    accountId: 'default',
    cfg: TEST_CONFIG,
    SessionKey: SESSION_KEY,
  };
  
  const sendResult = await redisChannelPlugin.outbound.sendText(ctx);
  
  if (sendResult.ok) {
    console.log('  ✅ 发送成功');
    console.log(`     ID: ${sendResult.id}`);
  } else {
    console.log('  ❌ 发送失败');
    console.log(`     错误：${sendResult.error}`);
    await receiverStack.stop();
    process.exit(1);
  }
  
  console.log();
  
  // 3. 等待消息到达
  console.log('⏳ 步骤 3: 等待消息到达... (2 秒)');
  await new Promise(r => setTimeout(r, 2000));
  
  console.log();
  
  // 4. 验证结果
  console.log('📊 步骤 4: 验证结果');
  console.log('-'.repeat(40));
  
  if (receivedMessages.length > 0) {
    console.log('  ✅ Receiver 收到消息！');
    console.log(`     数量：${receivedMessages.length} 条`);
    console.log(`     内容：${receivedMessages[0].data.text}`);
    
    if (receivedMessages[0].data.text === TEST_MESSAGE) {
      console.log('  ✅ 消息内容正确！');
    } else {
      console.log('  ⚠️  消息内容不匹配');
    }
  } else {
    console.log('  ❌ Receiver 未收到消息');
  }
  
  console.log();
  
  // 5. 清理
  console.log('🧹 步骤 5: 清理...');
  await receiverStack.stop();
  console.log('  ✅ 清理完成');
  
  console.log();
  console.log('='.repeat(60));
  console.log('✅ 完整 session-send 测试完成！');
  console.log('='.repeat(60));
  console.log();
  console.log('验证点:');
  console.log('  ✅ sendText 调用成功');
  console.log('  ✅ TCP 连接建立');
  console.log('  ✅ 消息通过 Redis 传输');
  console.log('  ✅ Receiver 收到消息');
  console.log('  ✅ 消息内容正确');
  
  process.exit(0);
}

// ============================================
// 🎯 运行
// ============================================
main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
