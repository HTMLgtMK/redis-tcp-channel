/**
 * Redis Channel 插件内部类型定义
 */

export interface RedisChannelAccountConfig {
  enabled: boolean;
  redisUrl: string;
  deviceId: string;
  deviceName?: string;
  heartbeatInterval?: number;
  subscribeChannel?: string;
  publishChannel?: string;
  senderNamePrefix?: string;
  messageFormat?: 'json' | 'text';
  // NEW: Message routing config
  targetSession?: string;        // Target session ID (default: agent:main:main)
  autoExecute?: boolean;         // Auto-execute commands in messages (default: false)
  showSenderPrefix?: boolean;    // Add [Sender] prefix to message text (default: true)
}

/**
 * 获取订阅频道，支持默认值
 */
export function getSubscribeChannel(config: RedisChannelAccountConfig): string {
  if (config.subscribeChannel) {
    return config.subscribeChannel;
  }
  return `openclaw:device:${config.deviceId}`;
}

/**
 * 获取发布频道，支持默认值
 */
export function getPublishChannel(config: RedisChannelAccountConfig, targetDeviceId: string): string {
  if (config.publishChannel) {
    return config.publishChannel;
  }
  return `openclaw:device:${targetDeviceId}`;
}

/**
 * 统一消息结构体（双向兼容）
 * Inbound 和 Outbound 使用相同格式，确保 GBOT 和 GLife 可以互相解析
 */
export interface RedisMessagePayload {
  senderId: string;          // 发送者 ID（必填）
  senderName?: string;       // 发送者名称（可选）
  text: string;              // 消息内容（必填）
  timestamp: number;         // 时间戳（必填）
  isGroup?: boolean;         // 是否群组消息（可选）
  groupId?: string;          // 群组 ID（可选）
  messageId?: string;        // 消息 ID（可选，用于追踪）
  metadata?: Record<string, any>;  // 扩展元数据（可选）
}

// 兼容旧版本的类型别名
export type InboundMessagePayload = RedisMessagePayload;
export type OutboundMessagePayload = RedisMessagePayload;

export interface NormalizedMessage {
  id: string;
  channel: string;
  accountId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
  groupId?: string;
  metadata?: Record<string, any>;
}
