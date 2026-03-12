// Redis Channel 插件包装器
// 提供 PluginRuntime 访问能力

import type { ChannelPlugin, OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { redisChannelPlugin } from './index';
import { setPluginRuntime } from './lib/runtime';

// Debug logger - only outputs when DEBUG env var includes 'redis-channel'
function debugLog(message: string): void {
  if (process.env.DEBUG?.includes('redis-channel')) {
    console.log(`[redis-channel-plugin-debug] ${message}`);
  }
}

const plugin = {
  id: 'redis-channel',
  name: 'Redis Channel',
  description: 'Redis Pub/Sub messaging channel for OpenClaw',
  version: '1.1.3',
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    // 保存 PluginRuntime 供 channel 使用
    setPluginRuntime(api.runtime);

    debugLog('Starting registration...');
    debugLog(`redisChannelPlugin.outbound exists: ${!!redisChannelPlugin.outbound}`);
    debugLog(`redisChannelPlugin.outbound.sendText exists: ${!!redisChannelPlugin.outbound?.sendText}`);
    debugLog(`redisChannelPlugin.outbound.resolveTarget exists: ${!!redisChannelPlugin.outbound?.resolveTarget}`);

    // 兼容新旧版本：直接传递完整插件对象
    // 新版本 OpenClaw 期望 plugin 对象包含所有属性
    // 旧版本可能只读取部分属性
    const channelPlugin: ChannelPlugin = {
      id: redisChannelPlugin.id,
      meta: redisChannelPlugin.meta,
      capabilities: redisChannelPlugin.capabilities,
      messaging: redisChannelPlugin.messaging,
      configSchema: redisChannelPlugin.configSchema,
      config: redisChannelPlugin.config,
      outbound: redisChannelPlugin.outbound,
      gateway: redisChannelPlugin.gateway,
    };

    debugLog(`channelPlugin.outbound exists: ${!!channelPlugin.outbound}`);
    debugLog(`channelPlugin.outbound.sendText exists: ${!!channelPlugin.outbound?.sendText}`);
    debugLog('Calling api.registerChannel...');
    
    // 注册 channel 插件
    api.registerChannel({ plugin: channelPlugin });
    
    debugLog('api.registerChannel called successfully');
    debugLog('Registration complete');
  },
};

export default plugin;
