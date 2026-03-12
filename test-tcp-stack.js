#!/usr/bin/env node
/**
 * TCP Stack 双终端测试（新架构）
 * 
 * 用法:
 *   node test-tcp-stack.js --device-id=tcp-test-a --target=tcp-test-b --role=receiver
 *   node test-tcp-stack.js --device-id=tcp-test-b --target=tcp-test-a --role=initiator
 */

const { createPhysicalLayer } = require('./dist/modules/physical-layer');
const { createInboundStack } = require('./dist/modules/inbound-stack');
const { createRedisChannelStack, TcpConnectionPool } = require('./dist/modules');

// ============================================
// 🔧 命令行参数解析
// ============================================
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  
  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) {
      params[key.slice(2)] = value;
    }
  }
  
  return params;
}

// ============================================
// 🚀 主函数
// ============================================
async function main() {
  const params = parseArgs();
  
  const deviceId = params['device-id'] || 'tcp-test-a';
  const target = params['target'] || 'tcp-test-b';
  const role = params['role'] || 'receiver';
  const redisPassword = process.env.REDIS_PASSWORD || '${REDIS_PASSWORD:-redis123}';
  const redisUrl = `redis://:${redisPassword}@localhost:16379`;
  
  console.log('='.repeat(60));
  console.log('🧪 Redis TCP Channel 测试（新架构）');
  console.log('='.repeat(60));
  console.log('Device:', deviceId);
  console.log('Target:', target);
  console.log('Role:', role);
  console.log('Redis:', redisUrl.replace(/:[^:]+@/, ':***@'));
  console.log('='.repeat(60));
  console.log();
  
  // 重置连接池（测试用）
  TcpConnectionPool['instance'] = null;
  
  if (role === 'receiver') {
    // ========== Receiver 模式 ==========
    const physicalLayer = createPhysicalLayer({
      redisUrl,
      deviceId,
    });
    
    const inboundStack = createInboundStack(deviceId, `inbound-${deviceId}`);
    inboundStack.setPhysicalLayer(physicalLayer);
    
    let messageCount = 0;
    inboundStack.onMessage((msg) => {
      messageCount++;
      console.log();
      console.log('📥 收到消息:');
      console.log('  Type:', msg.type);
      console.log('  Data:', JSON.stringify(msg.data));
      console.log('  Timestamp:', new Date(msg.timestamp).toLocaleTimeString());
      
      // 自动回复
      if (messageCount <= 3) {
        console.log();
        console.log('📤 自动回复...');
        inboundStack.sendMessage({
          type: 'response',
          data: { 
            message: `收到！来自 ${deviceId}`,
            replyTo: msg.data.message || msg.data.text,
          },
          timestamp: Date.now(),
          _connectionId: msg._connectionId,
        }).catch(console.error);
      }
    });
    
    await physicalLayer.start({
      onMessage: () => {},
      onDisconnect: () => {}
    });
    
    await inboundStack.start();
    
    console.log('✅ 已启动');
    console.log();
    console.log('⏳ 等待对方发送消息... (Ctrl+C 退出)');
    console.log();
    console.log('提示：在另一个终端运行:');
    console.log(`  node test-tcp-stack.js --device-id=${target} --target=${deviceId} --role=initiator`);
    console.log();
    
    // 保持运行
    await new Promise(() => {});
    
  } else {
    // ========== Sender 模式 ==========
    const physicalLayer = createPhysicalLayer({
      redisUrl,
      deviceId,
    });
    
    const stack = createRedisChannelStack({
      deviceId,
      targetDeviceId: target,
      connectionId: `tcp-test-${Date.now()}`,
      isInitiator: true,
      initialMessage: {
        type: 'greeting',
        data: { message: `Hello from ${deviceId}!` },
        timestamp: Date.now(),
      },
    });
    
    stack.setPhysicalLayer(physicalLayer);
    
    stack.onMessage((msg) => {
      console.log();
      console.log('📥 收到回复:');
      console.log('  Type:', msg.type);
      console.log('  Data:', JSON.stringify(msg.data));
    });
    
    await physicalLayer.start({
      onMessage: () => {},
      onDisconnect: () => {}
    });
    
    await stack.start();
    
    console.log('✅ 已启动');
    console.log();
    
    // 发送测试消息
    console.log('⏳ 等待 2 秒后发送测试消息...');
    await new Promise(r => setTimeout(r, 2000));
    
    console.log();
    console.log('📤 发送第 1 条消息...');
    await stack.sendMessage({
      type: 'message',
      data: { text: '测试消息 1', sequence: 1 },
      timestamp: Date.now(),
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    console.log();
    console.log('📤 发送第 2 条消息...');
    await stack.sendMessage({
      type: 'message',
      data: { text: '测试消息 2', sequence: 2 },
      timestamp: Date.now(),
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    console.log();
    console.log('📤 发送第 3 条消息...');
    await stack.sendMessage({
      type: 'message',
      data: { text: '测试消息 3', sequence: 3 },
      timestamp: Date.now(),
    });
    
    // 保持运行一段时间后关闭
    console.log();
    console.log('⏱️  运行 10 秒后关闭...');
    await new Promise(r => setTimeout(r, 10000));
    
    console.log();
    console.log('🛑 关闭连接...');
    await stack.stop();
    await physicalLayer.stop();
    
    console.log();
    console.log('✅ 测试完成!');
    process.exit(0);
  }
}

// ============================================
// 🎯 运行
// ============================================
main().catch(err => {
  console.error('❌ 测试失败:', err);
  console.error(err.stack);
  process.exit(1);
});
