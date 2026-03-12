#!/usr/bin/env ts-node
/**
 * 测试脚本：向 OpenClaw 发送入站消息
 * 用法：npm run test:pub -- --text "Hello" --sender "user123" --device-id "node-local"
 */

import { createClient } from 'redis';
import { program } from 'commander';

program
  .option('-r, --redis <url>', 'Redis URL', 'redis://localhost:6379')
  .option('-d, --device-id <id>', 'Target Device ID (for default channel)', 'node-local')
  .option('-c, --channel <name>', 'Publish channel (default: openclaw:device:<device-id>)')
  .option('-t, --text <message>', 'Message text', 'Hello from test script!')
  .option('-s, --sender <id>', 'Sender ID', 'test-user')
  .option('-n, --name <name>', 'Sender name', 'Test User')
  .option('-g, --group <id>', 'Group ID (optional)')
  .parse();

const opts = program.opts();

async function main() {
  const publishChannel = opts.channel || `openclaw:device:${opts.deviceId}`;
  const client = createClient({ url: opts.redis });

  client.on('error', (err) => {
    console.error('Redis error:', err);
    process.exit(1);
  });

  await client.connect();

  const payload = {
    senderId: opts.sender,
    senderName: opts.name,
    text: opts.text,
    timestamp: Date.now(),
    isGroup: !!opts.group,
    groupId: opts.group,
    metadata: { source: 'test-script' }
  };

  try {
    await client.publish(publishChannel, JSON.stringify(payload));
    console.log('✅ Message published:', {
      channel: publishChannel,
      sender: opts.sender,
      text: opts.text.slice(0, 50) + (opts.text.length > 50 ? '...' : '')
    });
  } catch (err) {
    console.error('❌ Publish failed:', err);
  } finally {
    await client.quit();
  }
}

main().catch(console.error);
