#!/usr/bin/env node
/**
 * 调试 Receiver - 详细日志
 */

const { createRedisChannelStack } = require('./dist/modules');

const redisUrl = 'redis://:${REDIS_PASSWORD:-redis123}@localhost:16379';
const deviceId = 'debug-receiver';
const targetDevice = 'debug-sender';
const connectionId = 'tcp-debug-session';

async function main() {
  console.log('='.repeat(60));
  console.log('🔍 调试 Receiver');
  console.log('='.repeat(60));
  
  const stack = createRedisChannelStack({
    redisUrl,
    deviceId,
    targetDeviceId: targetDevice,
    connectionId,
    isInitiator: false,
  });
  
  stack.onMessage((msg) => {
    console.log();
    console.log('📨 应用层收到消息:');
    console.log('  Type:', msg.type);
    console.log('  Data:', JSON.stringify(msg.data));
    console.log('  Timestamp:', new Date(msg.timestamp).toLocaleTimeString());
  });
  
  stack.onDisconnect(() => {
    console.log();
    console.log('🔴 连接断开');
  });
  
  console.log();
  console.log('⏳ 启动 Receiver...');
  await stack.start();
  console.log('✅ Receiver 已启动');
  console.log();
  console.log('等待 Sender 发送消息... (按 Ctrl+C 退出)');
  console.log();
  console.log('Sender 命令:');
  console.log(`  node test-tcp-stack.js --device-id=${targetDevice} --target=${deviceId} --role=initiator`);
  console.log();
  
  // 保持运行
  await new Promise(r => setTimeout(r, 30000));
  
  console.log();
  console.log('🛑 关闭...');
  await stack.stop();
  process.exit(0);
}

main().catch(console.error);
