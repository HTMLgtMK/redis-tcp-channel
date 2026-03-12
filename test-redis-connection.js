#!/usr/bin/env node
/**
 * 测试 Redis 连接（GBOT 机器）
 */

const { createClient } = require('redis');

async function testRedis() {
  console.log('='.repeat(60));
  console.log('🧪 测试 Redis 连接（GBOT 机器）');
  console.log('='.repeat(60));
  console.log();
  
  const redisUrl = process.env.REDIS_URL || 'redis://:' + (process.env.REDIS_PASSWORD || '') + '@localhost:16379';
  
  console.log('Redis URL:', redisUrl);
  console.log('SSH 隧道：localhost:16379 → GBOT:6379');
  console.log();
  
  const client = createClient({ url: redisUrl });
  
  try {
    console.log('⏳ 连接中...');
    await client.connect();
    console.log('✅ 连接成功！');
    console.log();
    
    // Ping 测试
    console.log('🏓 Ping 测试...');
    const pingResult = await client.ping();
    console.log('  结果:', pingResult);
    console.log();
    
    // 获取 Redis 信息
    console.log('📊 Redis 信息...');
    const info = await client.info('server');
    const lines = info.split('\r\n').filter(line => line.includes(':'));
    console.log('  版本:', lines.find(l => l.includes('redis_version'))?.split(':')[1]);
    console.log('  模式:', lines.find(l => l.includes('redis_mode'))?.split(':')[1]);
    console.log();
    
    // 发布/订阅测试
    console.log('📡 发布/订阅测试...');
    const subscriber = client.duplicate();
    await subscriber.connect();
    
    await new Promise((resolve) => {
      subscriber.subscribe('test-channel', (message) => {
        console.log('  收到消息:', message);
        resolve();
      });
      
      setTimeout(async () => {
        await client.publish('test-channel', 'Hello from test!');
      }, 100);
    });
    
    await subscriber.quit();
    console.log('  ✅ 发布/订阅测试通过！');
    console.log();
    
    await client.quit();
    console.log('✅ 所有测试通过！');
    console.log();
    console.log('📝 下一步:');
    console.log('  运行模块层测试：');
    console.log('  node test-tcp-stack.js --device-id=device-a --target=device-b --role=initiator');
    console.log();
    
  } catch (err) {
    console.error('❌ 连接失败:', err.message);
    console.error();
    console.error('可能的原因:');
    console.error('  1. SSH 隧道未建立');
    console.error('  2. GBOT 机器 Redis 未运行');
    console.error('  3. 防火墙阻止连接');
    console.error();
    console.error('检查 SSH 隧道:');
    console.error('  ps aux | grep ssh');
    console.error();
    process.exit(1);
  }
}

testRedis().catch(console.error);
