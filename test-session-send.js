#!/usr/bin/env node
/**
 * 模拟 OpenClaw session-send 命令测试
 * 
 * 直接调用插件的 sendText 方法，模拟 session-send 流程
 */

const { redisChannelPlugin } = require('./dist/index');
const { getSessionService } = require('./dist/business/session-service');

// ============================================
// 🔧 测试配置
// ============================================
const TEST_CONFIG = {
  channels: {
    'redis-channel': {
      accounts: {
        default: {
          enabled: true,
          redisUrl: 'redis://:${REDIS_PASSWORD:-redis123}@localhost:16379',
          deviceId: 'session-send-test-a',
          deviceName: 'Session Send Test A',
        }
      }
    }
  }
};

const TO_DEVICE = 'session-send-test-b';
const MESSAGE = 'Hello from session-send test!';

// ============================================
// 🚀 主测试函数
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 模拟 OpenClaw session-send 测试');
  console.log('='.repeat(60));
  console.log();
  console.log('配置:');
  console.log(`  To: ${TO_DEVICE}`);
  console.log(`  Message: ${MESSAGE}`);
  console.log(`  Channel: redis-tcp-channel`);
  console.log();
  
  // 模拟 OpenClaw 调用 sendText
  console.log('📤 调用 sendText...');
  console.log('-'.repeat(40));
  
  const ctx = {
    text: MESSAGE,
    to: TO_DEVICE,
    accountId: 'default',
    cfg: TEST_CONFIG,
    SessionKey: `session-send-${Date.now()}`,
  };
  
  try {
    const result = await redisChannelPlugin.outbound.sendText(ctx);
    
    console.log();
    if (result.ok) {
      console.log('✅ session-send 成功！');
      console.log();
      console.log('返回结果:');
      console.log(`  ok: ${result.ok}`);
      console.log(`  id: ${result.id}`);
      console.log(`  channel: ${result.channel}`);
      console.log(`  to: ${result.to}`);
      console.log(`  accountId: ${result.accountId}`);
    } else {
      console.log('❌ session-send 失败！');
      console.log();
      console.log(`错误：${result.error}`);
    }
  } catch (err) {
    console.log();
    console.log('❌ 异常！');
    console.log();
    console.log(`错误：${err.message}`);
    console.log(`堆栈：${err.stack}`);
  }
  
  console.log();
  console.log('='.repeat(60));
  console.log('测试完成！');
  console.log('='.repeat(60));
  
  // 清理
  const sessionService = getSessionService();
  await sessionService.stop();
  
  process.exit(0);
}

// ============================================
// 🎯 运行
// ============================================
main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
