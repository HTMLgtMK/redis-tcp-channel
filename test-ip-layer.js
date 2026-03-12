#!/usr/bin/env node
/**
 * 测试 IP 层（装包/拆包）
 */

const { createIPLayer } = require('./dist/modules/ip-layer/ip-layer');

const redisPassword = process.env.REDIS_PASSWORD || '';
const redisUrl = `redis://:${redisPassword}@localhost:16379`;

async function testIPLayer() {
  console.log('='.repeat(60));
  console.log('🧪 测试 IP 层（装包/拆包）');
  console.log('='.repeat(60));
  console.log();
  
  // 创建接收方 IP 层
  console.log('📥 创建接收方 (node-sub-1)...');
  const receiverIp = createIPLayer({
    redisUrl,
    deviceId: 'node-sub-1',
  });
  
  receiverIp.onReceive('node-sub-1', (segment) => {
    console.log();
    console.log('📬 收到 TCP Segment!');
    console.log('  connection_id:', segment._tcp.connection_id);
    console.log('  seq:', segment._tcp.seq);
    console.log('  flags:', segment._tcp.flags);
    console.log();
  });
  
  console.log('  ✅ 已订阅');
  console.log();
  
  // 等待订阅完成
  await new Promise(r => setTimeout(r, 2000));
  
  // 创建发送方 IP 层
  console.log('📤 创建发送方 (node-parent)...');
  const senderIp = createIPLayer({
    redisUrl,
    deviceId: 'node-parent',
  });
  
  // 发送 TCP Segment
  const testSegment = {
    _tcp: {
      connection_id: 'test-001',
      seq: 1,
      ack: 0,
      flags: ['SYN'],
      timestamp: Date.now(),
    },
    payload: [],
  };
  
  console.log('  发送 SYN Segment...');
  await senderIp.send('node-sub-1', testSegment);
  console.log('  ✅ 已发送');
  console.log();
  
  // 等待消息
  console.log('⏳ 等待 5 秒...');
  await new Promise(r => setTimeout(r, 5000));
  
  console.log();
  console.log('✅ 测试完成！');
}

testIPLayer().catch(console.error);
