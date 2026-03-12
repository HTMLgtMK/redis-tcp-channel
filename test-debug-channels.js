#!/usr/bin/env node
/**
 * 调试 Redis 频道
 */

const { createClient } = require('redis');

const redisPassword = process.env.REDIS_PASSWORD || '';
const redisUrl = `redis://:${redisPassword}@localhost:16379`;

async function testChannels() {
  console.log('='.repeat(60));
  console.log('🧪 调试 Redis 频道');
  console.log('='.repeat(60));
  console.log();
  
  const client = createClient({ url: redisUrl });
  await client.connect();
  
  // 列出所有频道
  console.log('📡 当前活跃的 Redis 频道:');
  const channels = await client.pubSubChannels();
  console.log('  ', channels.length > 0 ? channels : '无活跃频道');
  console.log();
  
  // 测试发布
  console.log('📤 测试发布到 openclaw:device:device-b...');
  const result = await client.publish('openclaw:device:device-b', JSON.stringify({ test: 'hello', timestamp: Date.now() }));
  console.log('  订阅者数量:', result);
  console.log();
  
  // 订阅并等待消息
  console.log('📥 订阅 openclaw:device:device-a，等待 5 秒...');
  const subscriber = client.duplicate();
  await subscriber.connect();
  
  await new Promise((resolve) => {
    subscriber.subscribe('openclaw:device:device-a', (message) => {
      console.log('  收到消息:', message);
      resolve();
    });
    
    setTimeout(resolve, 5000);
  });
  
  await subscriber.quit();
  await client.quit();
  
  console.log();
  console.log('✅ 调试完成！');
}

testChannels().catch(console.error);
