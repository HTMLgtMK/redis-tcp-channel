#!/usr/bin/env node
/**
 * OpenClaw session-send 测试脚本
 * 
 * 测试通过 OpenClaw 发送消息到新插件
 * 
 * 用法:
 *   node test/test-openclaw-send.js --to=device-b --message="Hello TCP"
 */

const { exec } = require('child_process');
const path = require('path');

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
  
  const to = params['to'] || 'device-b';
  const message = params['message'] || 'Hello from TCP Channel';
  const channel = params['channel'] || 'redis-tcp-channel';
  
  console.log('='.repeat(60));
  console.log('🧪 OpenClaw session-send 测试');
  console.log('='.repeat(60));
  console.log('To:', to);
  console.log('Message:', message);
  console.log('Channel:', channel);
  console.log('='.repeat(60));
  console.log();
  
  // 使用 openclaw session-send 命令
  const command = `openclaw session-send --to=${to} --channel=${channel} "${message}"`;
  
  console.log('📤 执行命令:', command);
  console.log();
  
  await new Promise((resolve, reject) => {
    exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ 命令执行失败:', error.message);
        console.error('stderr:', stderr);
        reject(error);
        return;
      }
      
      console.log('✅ 命令执行成功');
      console.log();
      console.log('stdout:', stdout);
      
      if (stderr) {
        console.log('stderr:', stderr);
      }
      
      resolve();
    });
  });
  
  console.log();
  console.log('✅ 测试完成!');
}

// ============================================
// 🎯 运行
// ============================================
main().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
