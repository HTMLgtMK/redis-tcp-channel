/**
 * Redis Client Manager (ioredis 版本)
 * 
 * 使用 ioredis 替代 redis 库
 */

import Redis from 'ioredis';
import { RedisChannelAccountConfig, getSubscribeChannel } from './types';

export class RedisClientManager {
  private static clients: Map<string, Redis> = new Map();

  static async getClient(config: RedisChannelAccountConfig): Promise<Redis> {
    const subscribeChannel = getSubscribeChannel(config);
    const key = `${config.redisUrl}:${subscribeChannel}`;

    if (this.clients.has(key)) {
      const client = this.clients.get(key)!;
      if (client.status === 'ready') return client;
      // 连接已关闭，清理缓存
      this.debug(`Connection closed for ${key}, creating new connection...`);
      this.clients.delete(key);
    }

    this.debug(`Creating Redis connection: ${config.redisUrl}`);
    const startTime = Date.now();
    
    const client = new Redis(config.redisUrl, {
      retryStrategy: (retries: number) => {
        if (retries > 3) {
          console.error(`[redis-client] Max retries reached, giving up`);
          return null;
        }
        const delay = Math.min(retries * 50, 2000);
        this.debug(`Reconnecting (attempt ${retries}) in ${delay}ms...`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    client.on('error', (err: Error) => {
      console.error(`[redis-client] Error: ${err.message}`);
    });
    
    client.on('connect', () => {
      const elapsed = Date.now() - startTime;
      console.log(`[redis-client] ✅ Connected to ${config.redisUrl} (${elapsed}ms)`);
    });
    
    client.on('end', () => {
      this.debug(`Disconnected from ${config.redisUrl}`);
    });

    await client.ping();
    
    this.clients.set(key, client);
    return client;
  }

  static async closeClient(config: RedisChannelAccountConfig): Promise<void> {
    const subscribeChannel = getSubscribeChannel(config);
    const key = `${config.redisUrl}:${subscribeChannel}`;
    const client = this.clients.get(key);
    
    if (client) {
      await client.quit();
      this.clients.delete(key);
      this.debug(`Redis client closed for ${key}`);
    }
  }

  static async createSubscriber(config: RedisChannelAccountConfig): Promise<Redis> {
    const subscriber = new Redis(config.redisUrl, {
      lazyConnect: false,
    });
    
    await subscriber.ping();
    return subscriber;
  }

  static async closeSubscriber(subscriber: Redis): Promise<void> {
    await subscriber.quit();
  }

  private static debug(message: string): void {
    if (process.env.DEBUG?.includes('redis-channel')) {
      console.log(`[redis-client] ${message}`);
    }
  }
}
