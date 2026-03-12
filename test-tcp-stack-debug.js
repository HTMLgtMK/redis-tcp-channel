#!/usr/bin/env node
/**
 * TCP Stack 调试脚本 - 带详细日志
 */

const { createClient } = require('redis');

const redisPassword = process.env.REDIS_PASSWORD || '';
const redisUrl = `redis://:${redisPassword}@localhost:16379`;

async function testSubscribe() {
  console.log('='.repeat(60));
  console.log('🧪 测试订阅 node-sub-1');
  console.log('='.repeat(60));
  console.log();
  
  const client = createClient({ url: redisUrl });
  await client.connect();
  
  console.log('📥 订阅 openclaw:device:node-sub-1...');
  
  await client.subscribe('openclaw:device:node-sub-1', (message) => {
    console.log();
    console.log('📬 收到消息!');
    console.log('  内容:', message.slice(0, 100) + '...');
    console.log();
  });
  
  console.log('✅ 订阅成功，等待消息... (Ctrl+C 退出)');
  console.log();
  console.log('提示：在另一个终端运行:');
  console.log('  redis-cli -h localhost -p 16379 -a "${REDIS_PASSWORD:-redis123}" PUBLISH openclaw:device:node-sub-1 "test message"');
  console.log();
}

testSubscribe().catch(console.error);
