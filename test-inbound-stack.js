#!/usr/bin/env node
/**
 * Inbound Stack 测试
 * 
 * 测试接收方的完整流程：
 * 1. 启动 Inbound Stack（监听所有设备）
 * 2. 模拟外部发送 SYN 握手
 * 3. 验证收到消息
 */

const { createInboundStack } = require('./dist/modules/inbound-stack');
const { createPhysicalLayer } = require('./dist/modules/physical-layer');
const { createRedisChannelStack } = require('./dist/modules');

// ============================================
// 🔧 测试配置
// ============================================
const redisPassword = process.env.REDIS_PASSWORD || '${REDIS_PASSWORD:-redis123}';
const redisUrl = `redis://:${redisPassword}@localhost:16379`;

const RECEIVER_DEVICE = 'inbound-test-receiver';
const SENDER_DEVICE = 'inbound-test-sender';
const CONNECTION_ID = 'inbound-test-session-001';

// ============================================
// 🚀 主测试函数
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 Inbound Stack 测试（接收方）');
  console.log('='.repeat(60));
  console.log();
  
  // 1. 创建 Physical Layer
  console.log('📝 步骤 1: 创建 Physical Layer');
  console.log('-'.repeat(40));
  
  const physicalLayer = createPhysicalLayer({
    redisUrl,
    deviceId: RECEIVER_DEVICE,
    deviceName: 'Inbound Test Receiver',
  });
  
  await physicalLayer.start({
    onMessage: (channel, message) => {
      console.log(`  [PhysicalLayer] 收到：${channel}`);
    },
    onDisconnect: () => {
      console.log('  [PhysicalLayer] 断联');
    }
  });
  
  console.log('  ✅ Physical Layer 已启动');
  console.log();
  
  // 2. 创建 Inbound Stack
  console.log('📝 步骤 2: 创建 Inbound Stack');
  console.log('-'.repeat(40));
  
  const inboundStack = createInboundStack(
    RECEIVER_DEVICE,
    `inbound-${RECEIVER_DEVICE}`,
  );
  
  // 注入 Physical Layer
  inboundStack.setPhysicalLayer(physicalLayer);
  
  // 注册消息回调
  let messagesReceived = [];
  inboundStack.onMessage((msg) => {
    console.log(`  📨 Inbound Stack 收到消息:`);
    console.log(`     Type: ${msg.type}`);
    console.log(`     Data: ${JSON.stringify(msg.data)}`);
    messagesReceived.push(msg);
  });
  
  // 启动
  await inboundStack.start();
  console.log('  ✅ Inbound Stack 已启动，监听所有设备');
  console.log();
  
  // 3. 模拟 Sender 发送 SYN 握手
  console.log('📝 步骤 3: 模拟 Sender 发送 SYN 握手');
  console.log('-'.repeat(40));
  
  // 创建 Sender Stack
  const senderStack = createRedisChannelStack({
    deviceId: SENDER_DEVICE,
    targetDeviceId: RECEIVER_DEVICE,
    connectionId: CONNECTION_ID,
    isInitiator: true,
    initialMessage: {
      type: 'greeting',
      data: { 
        text: 'Hello from Sender!',
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    },
  });
  
  // 注入同一个 Physical Layer（模拟不同设备）
  const senderPhysicalLayer = createPhysicalLayer({
    redisUrl,
    deviceId: SENDER_DEVICE,
  });
  
  await senderPhysicalLayer.start({
    onMessage: () => {},
  });
  
  senderStack.setPhysicalLayer(senderPhysicalLayer);
  
  // 注册 Sender 的回调
  senderStack.onMessage((msg) => {
    console.log(`  📨 Sender 收到回复：${msg.data.text}`);
  });
  
  // 启动 Sender
  await senderStack.start();
  console.log('  ✅ Sender Stack 已启动');
  console.log();
  
  // 等待握手和消息传输
  console.log('⏳ 等待握手和消息传输... (3 秒)');
  await new Promise(r => setTimeout(r, 3000));
  
  console.log();
  
  // 4. 验证结果
  console.log('📊 步骤 4: 验证结果');
  console.log('-'.repeat(40));
  
  if (messagesReceived.length > 0) {
    console.log(`  ✅ Receiver 收到 ${messagesReceived.length} 条消息`);
    messagesReceived.forEach((msg, i) => {
      console.log(`     [${i+1}] ${msg.data.text}`);
    });
  } else {
    console.log('  ❌ Receiver 未收到消息');
  }
  
  console.log();
  
  // 5. 清理
  console.log('📝 步骤 5: 清理');
  console.log('-'.repeat(40));
  
  await senderStack.stop();
  await senderPhysicalLayer.stop();
  await inboundStack.stop();
  await physicalLayer.stop();
  
  console.log('  ✅ 所有资源已清理');
  
  console.log();
  console.log('='.repeat(60));
  console.log('✅ Inbound Stack 测试完成！');
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
