#!/usr/bin/env node
/**
 * 回复流程测试 - 验证 Agent 收到消息后可以回复
 * 
 * 流程：
 * 1. Sender 发送 SYN+Data
 * 2. Receiver 收到消息（带_connectionId）
 * 3. Receiver 回复（使用同一个_connectionId）
 * 4. Sender 收到回复
 */

const { createPhysicalLayer } = require('./dist/modules/physical-layer');
const { createInboundStack } = require('./dist/modules/inbound-stack');
const { createRedisChannelStack } = require('./dist/modules');

// ============================================
// 🔧 测试配置
// ============================================
const redisPassword = process.env.REDIS_PASSWORD || '${REDIS_PASSWORD:-redis123}';
const redisUrl = `redis://:${redisPassword}@localhost:16379`;

const RECEIVER_DEVICE = 'reply-test-receiver';
const SENDER_DEVICE = 'reply-test-sender';
const CONNECTION_ID = 'reply-test-session-001';

// ============================================
// 🚀 主测试函数
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 回复流程测试 - Agent 收到消息后回复');
  console.log('='.repeat(60));
  console.log();
  
  // 1. Receiver: 创建 InboundStack
  console.log('📝 步骤 1: Receiver 启动');
  console.log('-'.repeat(40));
  
  const receiverPhysicalLayer = createPhysicalLayer({
    redisUrl,
    deviceId: RECEIVER_DEVICE,
  });
  
  const inboundStack = createInboundStack(
    RECEIVER_DEVICE,
    `inbound-${RECEIVER_DEVICE}`,
  );
  
  inboundStack.setPhysicalLayer(receiverPhysicalLayer);
  
  const receivedMessages = [];
  
  // 注册消息回调 - 模拟 Agent 收到消息并回复
  inboundStack.onMessage(async (msg) => {
    console.log(`  📨 Receiver Agent 收到消息:`);
    console.log(`     Type: ${msg.type}`);
    console.log(`     Data: ${JSON.stringify(msg.data)}`);
    console.log(`     _connectionId: ${msg._connectionId}`);
    
    receivedMessages.push(msg);
    
    // ⭐ 等待更长时间，让 TCP 握手完成（SYN → SYN+ACK → ACK）
    // 实际场景中，ACK 会很快到达，但测试中需要显式等待
    await new Promise(r => setTimeout(r, 1000));
    
    // ⭐ Agent 回复（使用同一个_connectionId）
    console.log(`  📤 Receiver Agent 回复...`);
    try {
      await inboundStack.sendMessage({
        type: 'response',
        data: { 
          text: `收到：${msg.data.text}`,
          replyTo: msg.data.text,
        },
        timestamp: Date.now(),
        _connectionId: msg._connectionId,  // ← 关键！使用同一个 connectionId
      });
      console.log(`  ✅ 回复已发送`);
    } catch (err) {
      console.error(`  ❌ 回复失败：${err.message}`);
    }
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
  
  // 添加调试：监听 TCP Layer 状态变化
  console.log('  [DEBUG] Sender Stack 创建完成，准备启动...');
  
  senderStack.setPhysicalLayer(senderPhysicalLayer);
  
  const senderReceivedMessages = [];
  
  senderStack.onMessage((msg) => {
    console.log(`  📨 Sender 收到回复:`);
    console.log(`     Type: ${msg.type}`);
    console.log(`     Data: ${JSON.stringify(msg.data)}`);
    senderReceivedMessages.push(msg);
  });
  
  // ⭐ 先启动 PhysicalLayer（创建 subscriber），再启动 Stack
  await senderPhysicalLayer.start({
    onMessage: () => {},
    onDisconnect: () => {}
  });
  
  await senderStack.start();
  console.log('  ✅ Sender 已启动，已发送 SYN+Data');
  console.log();
  
  // 3. 等待消息传输和回复
  console.log('⏳ 等待消息传输和回复... (3 秒)');
  await new Promise(r => setTimeout(r, 3000));
  console.log();
  
  // 4. 验证结果
  console.log('📊 步骤 3: 验证结果');
  console.log('-'.repeat(40));
  
  console.log(`Receiver 收到 ${receivedMessages.length} 条消息:`);
  receivedMessages.forEach((msg, i) => {
    console.log(`  [${i+1}] ${msg.data.text} (connectionId: ${msg._connectionId})`);
  });
  
  console.log();
  
  console.log(`Sender 收到 ${senderReceivedMessages.length} 条回复:`);
  senderReceivedMessages.forEach((msg, i) => {
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
  console.log('✅ 回复流程测试完成！');
  console.log('='.repeat(60));
  
  if (receivedMessages.length > 0 && senderReceivedMessages.length > 0) {
    console.log();
    console.log('🎉 验证通过:');
    console.log('  ✅ Receiver 收到消息（带_connectionId）');
    console.log('  ✅ Agent 成功回复（使用_connectionId）');
    console.log('  ✅ Sender 收到回复');
  } else {
    console.log();
    console.log('❌ 验证失败:');
    if (receivedMessages.length === 0) {
      console.log('  ❌ Receiver 未收到消息');
    }
    if (senderReceivedMessages.length === 0) {
      console.log('  ❌ Sender 未收到回复');
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
