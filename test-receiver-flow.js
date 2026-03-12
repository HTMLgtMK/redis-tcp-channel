#!/usr/bin/env node
/**
 * 接收方流程测试 - 验证完整的消息接收链路
 * 
 * 流程：
 * 1. PhysicalLayer 订阅 Redis
 * 2. Sender 发送 SYN+Data
 * 3. PhysicalLayer 收到 → 拆包 → TcpSegment
 * 4. InboundStack 处理 SYN → 发送 SYN+ACK
 * 5. 提取 Data → 回调 onMessage
 */

const { createPhysicalLayer } = require('./dist/modules/physical-layer');
const { createRedisChannelStack } = require('./dist/modules');

// ============================================
// 🔧 测试配置
// ============================================
const redisPassword = process.env.REDIS_PASSWORD || '${REDIS_PASSWORD:-redis123}';
const redisUrl = `redis://:${redisPassword}@localhost:16379`;

const RECEIVER_DEVICE = 'receiver-flow-test';
const SENDER_DEVICE = 'sender-flow-test';
const CONNECTION_ID = 'flow-test-session-001';

// ============================================
// 🚀 主测试函数
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 接收方流程测试');
  console.log('='.repeat(60));
  console.log();
  
  // 1. Receiver: 创建 PhysicalLayer + Stack
  console.log('📝 步骤 1: Receiver 启动');
  console.log('-'.repeat(40));
  
  const receiverPhysicalLayer = createPhysicalLayer({
    redisUrl,
    deviceId: RECEIVER_DEVICE,
  });
  
  const receiverMessages = [];
  
  await receiverPhysicalLayer.start({
    onMessage: (channel, message) => {
      console.log(`  [Receiver PhysicalLayer] 收到原始消息`);
      console.log(`     Channel: ${channel}`);
      console.log(`     Message: ${message.substring(0, 100)}...`);
    },
    onDisconnect: () => {
      console.log('  [Receiver PhysicalLayer] 断联');
    }
  });
  
  console.log('  ✅ Receiver PhysicalLayer 已启动');
  
  // 创建 InboundStack（接收方专用）
  const { createInboundStack } = require('./dist/modules/inbound-stack');
  
  const inboundStack = createInboundStack(
    RECEIVER_DEVICE,
    `inbound-${RECEIVER_DEVICE}`,
  );
  
  inboundStack.setPhysicalLayer(receiverPhysicalLayer);  // 这会自动监听 PhysicalLayer 的 subscriber
  
  inboundStack.onMessage((msg) => {
    console.log(`  📨 InboundStack 收到消息:`);
    console.log(`     Type: ${msg.type}`);
    console.log(`     Data: ${JSON.stringify(msg.data)}`);
    receiverMessages.push(msg);
  });
  
  await inboundStack.start();
  console.log('  ✅ InboundStack 已启动');
  console.log();
  
  // 2. Sender: 创建 PhysicalLayer + Stack 并发送
  console.log('📝 步骤 2: Sender 启动并发送 SYN+Data');
  console.log('-'.repeat(40));
  
  const senderPhysicalLayer = createPhysicalLayer({
    redisUrl,
    deviceId: SENDER_DEVICE,
  });
  
  await senderPhysicalLayer.start({
    onMessage: () => {},
  });
  
  const senderStack = createRedisChannelStack({
    deviceId: SENDER_DEVICE,
    targetDeviceId: RECEIVER_DEVICE,
    connectionId: CONNECTION_ID,
    isInitiator: true,  // 发起方
    initialMessage: {
      type: 'greeting',
      data: { 
        text: 'Hello from Sender!',
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    },
  });
  
  senderStack.setPhysicalLayer(senderPhysicalLayer);
  
  senderStack.onMessage((msg) => {
    console.log(`  📨 Sender 收到回复：${msg.data.text}`);
  });
  
  await senderStack.start();
  console.log('  ✅ Sender Stack 已启动，已发送 SYN+Data');
  console.log();
  
  // 3. 等待握手和消息传输
  console.log('⏳ 等待握手和消息传输... (3 秒)');
  await new Promise(r => setTimeout(r, 3000));
  console.log();
  
  // 4. 验证结果
  console.log('📊 步骤 3: 验证结果');
  console.log('-'.repeat(40));
  
  if (receiverMessages.length > 0) {
    console.log(`  ✅ Receiver 收到 ${receiverMessages.length} 条消息`);
    receiverMessages.forEach((msg, i) => {
      console.log(`     [${i+1}] ${msg.data.text}`);
    });
  } else {
    console.log('  ❌ Receiver 未收到消息');
    console.log('  ⚠️  可能的问题：');
    console.log('     - IP Layer 未正确监听 PhysicalLayer');
    console.log('     - TCP Layer 未正确处理 SYN');
  }
  
  console.log();
  
  // 5. 清理
  console.log('📝 步骤 4: 清理');
  console.log('-'.repeat(40));
  
  await senderStack.stop();
  await senderPhysicalLayer.stop();
  await inboundStack.stop();
  await receiverPhysicalLayer.stop();
  
  console.log('  ✅ 所有资源已清理');
  
  console.log();
  console.log('='.repeat(60));
  console.log('✅ 测试完成！');
  console.log('='.repeat(60));
  
  process.exit(0);
}

// ============================================
// 🎯 运行
// ============================================
main().catch(err => {
  console.error('❌ 测试失败:', err);
  console.error(err.stack);
  process.exit(1);
});
