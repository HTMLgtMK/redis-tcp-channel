#!/usr/bin/env node
/**
 * Physical Layer 测试（ioredis 版本）
 * 
 * 测试 Physical Layer 的 Redis 连接、订阅、发布功能
 */

const { createPhysicalLayer } = require('./dist/modules/physical-layer');

// ============================================
// 🔧 测试配置
// ============================================
const redisPassword = process.env.REDIS_PASSWORD || '${REDIS_PASSWORD:-redis123}';
const redisUrl = `redis://:${redisPassword}@localhost:16379`;
const deviceId = 'physical-layer-test';

// ============================================
// 🚀 主测试函数
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 Physical Layer 测试（ioredis）');
  console.log('='.repeat(60));
  console.log();
  console.log('配置:');
  console.log(`  Redis URL: ${redisUrl.replace(/:[^:]+@/, ':***@')}`);
  console.log(`  Device ID: ${deviceId}`);
  console.log();
  
  // 创建 Physical Layer
  const physicalLayer = createPhysicalLayer({
    redisUrl,
    deviceId,
    deviceName: 'Physical Layer Test',
  });
  
  // 测试 1: 连接和订阅
  console.log('📝 测试 1: 连接和订阅');
  console.log('-'.repeat(40));
  
  let messageReceived = false;
  let messageContent = null;
  
  await physicalLayer.start({
    onMessage: (channel, message) => {
      console.log(`  📨 收到消息:`);
      console.log(`     Channel: ${channel}`);
      console.log(`     Message: ${message}`);
      messageReceived = true;
      messageContent = message;
    },
    onDisconnect: () => {
      console.log('  🔴 断联通知');
    }
  });
  
  console.log('  ✅ Physical Layer 已启动');
  console.log(`  ✅ 已订阅频道：openclaw:device:${deviceId}`);
  console.log();
  
  // 测试 2: 发布消息
  console.log('📝 测试 2: 发布消息');
  console.log('-'.repeat(40));
  
  const testMessage = JSON.stringify({
    test: true,
    text: 'Hello from Physical Layer test!',
    timestamp: Date.now(),
  });
  
  console.log(`  发送消息到：openclaw:device:${deviceId}`);
  await physicalLayer.publish(deviceId, testMessage);
  console.log('  ✅ 发布成功');
  console.log();
  
  // 等待消息到达
  console.log('⏳ 等待消息到达... (1 秒)');
  await new Promise(r => setTimeout(r, 1000));
  
  // 验证结果
  console.log('📊 验证结果');
  console.log('-'.repeat(40));
  
  if (messageReceived) {
    console.log('  ✅ 收到消息');
    if (messageContent === testMessage) {
      console.log('  ✅ 消息内容正确');
    } else {
      console.log('  ⚠️  消息内容不匹配');
    }
  } else {
    console.log('  ❌ 未收到消息');
  }
  
  console.log();
  
  // 测试 3: 健康检查
  console.log('📝 测试 3: 健康检查');
  console.log('-'.repeat(40));
  
  const isConnected = physicalLayer.isConnected();
  console.log(`  连接状态：${isConnected ? '✅ 已连接' : '❌ 未连接'}`);
  
  const client = physicalLayer.getClient();
  if (client) {
    const pingResult = await client.ping();
    console.log(`  Ping 结果：${pingResult}`);
  }
  
  console.log();
  
  // 测试 4: 清理
  console.log('📝 测试 4: 清理');
  console.log('-'.repeat(40));
  
  await physicalLayer.stop();
  console.log('  ✅ Physical Layer 已停止');
  
  const isStillConnected = physicalLayer.isConnected();
  console.log(`  连接状态：${isStillConnected ? '❌ 仍连接' : '✅ 已断开'}`);
  
  console.log();
  console.log('='.repeat(60));
  console.log('✅ 所有测试完成！');
  console.log('='.repeat(60));
  
  process.exit(0);
}

// ============================================
// 🎯 运行
// ============================================
main().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
