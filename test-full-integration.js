#!/usr/bin/env node
/**
 * 完整集成测试（新架构）
 * 
 * 测试双向通信：
 * 1. Receiver 监听
 * 2. Sender 发送 3 条消息
 * 3. Receiver 自动回复
 * 4. 验证双向消息到达
 */

const { createPhysicalLayer } = require('./dist/modules/physical-layer');
const { createInboundStack } = require('./dist/modules/inbound-stack');
const { createRedisChannelStack, TcpConnectionPool } = require('./dist/modules');

// ============================================
// 🔧 测试配置
// ============================================
const redisPassword = process.env.REDIS_PASSWORD || '${REDIS_PASSWORD:-redis123}';
const redisUrl = `redis://:${redisPassword}@localhost:16379`;

const RECEIVER_DEVICE = 'integration-receiver';
const SENDER_DEVICE = 'integration-sender';

// ============================================
// 🚀 主测试函数
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 完整集成测试（新架构）');
  console.log('='.repeat(60));
  console.log();
  
  // 重置连接池
  TcpConnectionPool['instance'] = null;
  
  // 1. Receiver: 创建 InboundStack
  console.log('📝 步骤 1: Receiver 启动');
  console.log('-'.repeat(40));
  
  const receiverPhysicalLayer = createPhysicalLayer({
    redisUrl,
    deviceId: RECEIVER_DEVICE,
  });
  
  const inboundStack = createInboundStack(RECEIVER_DEVICE, `inbound-${RECEIVER_DEVICE}`);
  inboundStack.setPhysicalLayer(receiverPhysicalLayer);
  
  const receiverMessages = [];
  const senderMessages = [];
  
  inboundStack.onMessage(async (msg) => {
    receiverMessages.push(msg);
    console.log(`  📨 Receiver 收到消息 #${receiverMessages.length}: ${msg.data.text}`);
    
    // 自动回复
    await inboundStack.sendMessage({
      type: 'response',
      data: { 
        text: `收到：${msg.data.text}`,
        replyTo: msg.data.text,
      },
      timestamp: Date.now(),
      _connectionId: msg._connectionId,
    });
    console.log(`  📤 Receiver 回复 #${receiverMessages.length}`);
  });
  
  await receiverPhysicalLayer.start({
    onMessage: () => {},
    onDisconnect: () => {}
  });
  
  await inboundStack.start();
  console.log('  ✅ Receiver 已启动');
  console.log();
  
  // 2. Sender: 创建 Stack 并发送
  console.log('📝 步骤 2: Sender 启动并发送消息');
  console.log('-'.repeat(40));
  
  const senderPhysicalLayer = createPhysicalLayer({
    redisUrl,
    deviceId: SENDER_DEVICE,
  });
  
  const senderStack = createRedisChannelStack({
    deviceId: SENDER_DEVICE,
    targetDeviceId: RECEIVER_DEVICE,
    connectionId: `integration-${Date.now()}`,
    isInitiator: true,
    initialMessage: {
      type: 'greeting',
      data: { text: 'Hello from Sender!' },
      timestamp: Date.now(),
    },
  });
  
  senderStack.setPhysicalLayer(senderPhysicalLayer);
  
  senderStack.onMessage((msg) => {
    senderMessages.push(msg);
    console.log(`  📨 Sender 收到回复 #${senderMessages.length}: ${msg.data.text}`);
  });
  
  await senderPhysicalLayer.start({
    onMessage: () => {},
    onDisconnect: () => {}
  });
  
  await senderStack.start();
  console.log('  ✅ Sender 已启动');
  console.log();
  
  // 等待握手完成
  await new Promise(r => setTimeout(r, 500));
  
  // 发送 3 条测试消息
  for (let i = 1; i <= 3; i++) {
    console.log(`  📤 发送第 ${i} 条消息...`);
    await senderStack.sendMessage({
      type: 'message',
      data: { text: `测试消息 ${i}`, sequence: i },
      timestamp: Date.now(),
    });
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log();
  
  // 3. 等待回复
  console.log('⏳ 等待回复... (3 秒)');
  await new Promise(r => setTimeout(r, 3000));
  console.log();
  
  // 4. 验证结果
  console.log('📊 步骤 3: 验证结果');
  console.log('-'.repeat(40));
  
  console.log(`Receiver 收到 ${receiverMessages.length} 条消息:`);
  receiverMessages.forEach((msg, i) => {
    console.log(`  [${i+1}] ${msg.data.text}`);
  });
  console.log();
  
  console.log(`Sender 收到 ${senderMessages.length} 条回复:`);
  senderMessages.forEach((msg, i) => {
    console.log(`  [${i+1}] ${msg.data.text}`);
  });
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
  console.log('✅ 完整集成测试完成！');
  console.log('='.repeat(60));
  
  // 验证
  if (receiverMessages.length >= 3 && senderMessages.length >= 3) {
    console.log();
    console.log('🎉 验证通过:');
    console.log(`  ✅ Receiver 收到 ${receiverMessages.length} 条消息 (期望>=3)`);
    console.log(`  ✅ Sender 收到 ${senderMessages.length} 条回复 (期望>=3)`);
  } else {
    console.log();
    console.log('❌ 验证失败:');
    if (receiverMessages.length < 3) {
      console.log(`  ❌ Receiver 只收到 ${receiverMessages.length} 条消息 (期望>=3)`);
    }
    if (senderMessages.length < 3) {
      console.log(`  ❌ Sender 只收到 ${senderMessages.length} 条回复 (期望>=3)`);
    }
  }
  
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
