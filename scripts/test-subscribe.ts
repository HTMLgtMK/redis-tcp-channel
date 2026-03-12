#!/usr/bin/env ts-node
/**
 * 测试脚本：监听 OpenClaw 发送的出站消息
 * 用法：npm run test:sub -- --redis "redis://localhost:6379" --device-id "node-local"
 */

import { createClient } from 'redis';
import { program } from 'commander';

program
  .option('-r, --redis <url>', 'Redis URL', 'redis://localhost:6379')
  .option('-d, --device-id <id>', 'Device ID (for default channel)', 'node-local')
  .option('-c, --channel <name>', 'Subscribe channel (default: openclaw:device:<device-id>)')
  .parse();

const opts = program.opts();

async function main() {
  const subscribeChannel = opts.channel || `openclaw:device:${opts.deviceId}`;
  const client = createClient({ url: opts.redis });

  client.on('error', (err) => console.error('Redis error:', err));
  client.on('connect', () => console.log(`🔌 Connected to ${opts.redis}`));

  await client.connect();

  console.log(`👂 Subscribing to ${subscribeChannel}... (Ctrl+C to exit)`);

  await client.subscribe(subscribeChannel, (message: string) => {
    try {
      const payload = JSON.parse(message);
      console.log('\n📩 Received from OpenClaw:');
      console.log(`   From: ${payload.from}`);
      console.log(`   To: ${payload.to}`);
      console.log(`   Text: ${payload.text}`);
      console.log(`   Time: ${new Date(payload.timestamp).toLocaleTimeString()}`);
      console.log('─'.repeat(50));
    } catch {
      console.log(`📄 Raw: ${message}`);
    }
  });

  process.on('SIGINT', async () => {
    console.log('\n👋 Disconnecting...');
    await client.unsubscribe(subscribeChannel);
    await client.quit();
    process.exit(0);
  });
}

main().catch(console.error);
