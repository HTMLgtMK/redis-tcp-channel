#!/usr/bin/env node
/**
 * 测试频道名称
 */

const { getSubscribeChannel, getPublishChannel } = require('./dist/lib/types');

const account1 = {
  redisUrl: 'redis://localhost:6379',
  deviceId: 'reply-test-sender',
};

const account2 = {
  redisUrl: 'redis://localhost:6379',
  deviceId: 'reply-test-receiver',
};

console.log('='.repeat(60));
console.log('📊 频道名称测试');
console.log('='.repeat(60));
console.log();

console.log('Sender:');
console.log(`  订阅频道：${getSubscribeChannel(account1)}`);
console.log(`  发布到 receiver：${getPublishChannel(account1, 'reply-test-receiver')}`);
console.log();

console.log('Receiver:');
console.log(`  订阅频道：${getSubscribeChannel(account2)}`);
console.log(`  发布到 sender：${getPublishChannel(account2, 'reply-test-sender')}`);
console.log();

console.log('验证:');
console.log(`  Sender 发布频道 == Receiver 订阅频道：${getPublishChannel(account1, 'reply-test-receiver') === getSubscribeChannel(account2)}`);
console.log(`  Receiver 发布频道 == Sender 订阅频道：${getPublishChannel(account2, 'reply-test-sender') === getSubscribeChannel(account1)}`);
