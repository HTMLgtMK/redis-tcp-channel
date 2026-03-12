import { v4 as uuidv4 } from 'uuid';
import { RedisClientManager } from './redis-client';
import { RedisMessagePayload, RedisChannelAccountConfig, getPublishChannel } from './types';
import { TcpSegment, TcpFlags } from '../modules/tcp-layer/types';

// Define the result type for sending messages
export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

// ============================================
// 📤 IP 层发送（原始消息，不保证可靠）
// ============================================
export async function sendOutboundMessage(
  text: string,
  target: { id: string },
  account: RedisChannelAccountConfig
): Promise<SendResult> {
  let client;

  try {
    client = await RedisClientManager.getClient(account);

    // 使用统一的消息结构体
    const payload: RedisMessagePayload = {
      senderId: account.deviceId,
      senderName: account.deviceName,
      text,
      timestamp: Date.now(),
      isGroup: false,
      messageId: uuidv4()
    };

    // 强制使用 JSON 格式发送
    const message = JSON.stringify(payload);

    const publishChannel = getPublishChannel(account, target.id);
    await client.publish(publishChannel, message);

    return { ok: true, id: payload.messageId };

  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ============================================
// 📤 传输层发送（TCP Segment，可靠传输）
// ============================================
export async function sendTcpSegment(
  segment: TcpSegment,
  target: { id: string },
  account: RedisChannelAccountConfig
): Promise<SendResult> {
  let client;

  try {
    client = await RedisClientManager.getClient(account);

    // 发送 TCP Segment（包含 _tcp 字段）
    const message = JSON.stringify(segment);

    const publishChannel = getPublishChannel(account, target.id);
    await client.publish(publishChannel, message);

    return { ok: true, id: `tcp-${segment._tcp.seq}` };

  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}


