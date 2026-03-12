#!/usr/bin/env node
/**
 * Redis TCP Channel 插件集成测试
 * 
 * 测试 session-service 与 TCP Stack 的集成
 */

const { getSessionService } = require('./dist/business/session-service');

// ============================================
// 🔧 测试配置
// ============================================
const TEST_ACCOUNT = {
  enabled: true,
  redisUrl: 'redis://:${REDIS_PASSWORD:-redis123}@localhost:16379',
  deviceId: 'plugin-test-a',
  deviceName: 'Plugin Test A',
};

const TARGET_DEVICE = 'plugin-test-b';

// ============================================
// 🚀 主测试函数
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 Redis TCP Channel 插件集成测试');
  console.log('='.repeat(60));
  console.log();
  
  const sessionService = getSessionService();
  
  // 测试 1: 发送单条消息
  console.log('📝 测试 1: 发送单条消息');
  console.log('-'.repeat(40));
  const sessionKey1 = `test-session-${Date.now()}`;
  
  try {
    const result1 = await sessionService.sendMessage(
      TEST_ACCOUNT,
      TARGET_DEVICE,
      sessionKey1,
      'Hello from plugin integration test!'
    );
    
    if (result1.ok) {
      console.log('✅ 消息发送成功');
      console.log(`   SessionKey: ${sessionKey1}`);
      console.log(`   ID: ${result1.id}`);
    } else {
      console.log('❌ 消息发送失败:', result1.error);
    }
  } catch (err) {
    console.log('❌ 异常:', err.message);
  }
  
  console.log();
  
  // 测试 2: 多轮对话（复用会话）
  console.log('📝 测试 2: 多轮对话（复用会话）');
  console.log('-'.repeat(40));
  const sessionKey2 = `multi-turn-${Date.now()}`;
  
  for (let i = 1; i <= 3; i++) {
    console.log(`\n第 ${i} 轮:`);
    try {
      const result = await sessionService.sendMessage(
        TEST_ACCOUNT,
        TARGET_DEVICE,
        sessionKey2,
        `第 ${i} 轮测试消息`
      );
      
      if (result.ok) {
        console.log(`  ✅ 发送成功 (ID: ${result.id})`);
      } else {
        console.log(`  ❌ 发送失败: ${result.error}`);
      }
    } catch (err) {
      console.log(`  ❌ 异常: ${err.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log();
  
  // 测试 3: 查看会话统计
  console.log('📊 测试 3: 会话统计');
  console.log('-'.repeat(40));
  const stats = sessionService.getStats();
  console.log(`总会话数：${stats.totalSessions}`);
  stats.sessions.forEach(s => {
    console.log(`  - ${s.key}: ${s.messageCount} 条消息`);
  });
  
  console.log();
  
  // 清理
  console.log('🧹 清理会话...');
  await sessionService.stop();
  console.log('✅ 清理完成');
  
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
