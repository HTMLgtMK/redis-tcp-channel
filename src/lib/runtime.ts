import type { PluginRuntime } from 'openclaw/plugin-sdk';

let pluginRuntime: PluginRuntime | null = null;

/**
 * 设置 PluginRuntime（在插件注册时调用）
 */
export function setPluginRuntime(runtime: PluginRuntime): void {
  pluginRuntime = runtime;
}

/**
 * 获取 PluginRuntime
 */
export function getPluginRuntime(): PluginRuntime {
  if (!pluginRuntime) {
    throw new Error('PluginRuntime not initialized. Make sure plugin.ts register() was called.');
  }
  return pluginRuntime;
}
