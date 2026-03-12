/**
 * Physical Layer - 物理连接层
 * 
 * 职责：
 * - 管理 Redis 连接（整个插件生命周期）
 * - 订阅频道接收消息
 * - 发布消息到频道
 * - 分发消息到对应的 Stack
 * 
 * 生命周期：与插件相同（gateway.startAccount → gateway.stopAccount）
 * 
 * 使用 ioredis 而非 redis 库的原因：
 * - ioredis 更成熟稳定，生产环境广泛使用
 * - 更好的集群支持和哨兵模式
 * - 更丰富的功能和更好的性能
 * - 原生 Promise 支持
 */

import Redis from 'ioredis';
import type { ILogger } from '../lib/logger';
import { RedisChannelAccountConfig, getSubscribeChannel, getPublishChannel } from '../lib/types';

// ============================================
// 📥 消息回调
// ============================================
export interface PhysicalLayerCallbacks {
  // 收到原始 Redis 消息
  onMessage: (channel: string, message: string) => void | Promise<void>;
  
  // 断联回调
  onDisconnect?: () => void;
}

// ============================================
// 🔌 Physical Layer 接口
// ============================================
export interface IPhysicalLayer {
  /**
   * 启动（连接 Redis、订阅频道）
   */
  start(callbacks: PhysicalLayerCallbacks): Promise<void>;
  
  /**
   * 发布消息
   */
  publish(targetDeviceId: string, message: string): Promise<void>;
  
  /**
   * 停止（断开连接、取消订阅）
   */
  stop(): Promise<void>;
  
  /**
   * 检查连接状态
   */
  isConnected(): boolean;
  
  /**
   * 获取 Redis 客户端（用于健康检查）
   */
  getClient(): Redis | null;
}



// ============================================
// 🎯 Physical Layer 实现
// ============================================
export class PhysicalLayerImpl implements IPhysicalLayer {
  private config: {
    redisUrl: string;
    deviceId: string;
    deviceName?: string;
  };
  
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private callbacks: PhysicalLayerCallbacks | null = null;
  private connected: boolean = false;
  private logger: ILogger;
  
  constructor(
    config: { redisUrl: string; deviceId: string; deviceName?: string },
    logger?: ILogger
  ) {
    this.config = config;
    this.logger = logger || {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: () => {},
    };
  }
  
  // ============================================
  // 🚀 启动（连接 Redis、订阅频道）
  // ============================================
  async start(callbacks: PhysicalLayerCallbacks): Promise<void> {
    this.callbacks = callbacks;
    const startTime = Date.now();
    
    try {
      // 创建订阅者（ioredis）- 直接传入 URL
      this.subscriber = new Redis(this.config.redisUrl);
      
      this.subscriber.on('error', (err: Error) => {
        this.logger.error('[PhysicalLayer] Subscriber 错误:', err);
        this.connected = false;
        this.callbacks?.onDisconnect?.();
      });
      
      this.subscriber.on('end', () => {
        this.logger.info('[PhysicalLayer] Subscriber 连接关闭');
        this.connected = false;
        this.callbacks?.onDisconnect?.();
      });
      
      this.subscriber.on('connect', () => {
        this.logger.info('[PhysicalLayer] Subscriber 已连接');
      });
      
      // 等待连接就绪
      await this.subscriber.ping();
      
      // 订阅频道
      const subscribeChannel = getSubscribeChannel(this.config as RedisChannelAccountConfig);
      await this.subscriber.subscribe(subscribeChannel);
      
      // 注册消息处理器（调用回调，由 InboundStack 处理）
      this.subscriber.on('message', (channel: string, message: string) => {
        this.logger.info(`[PhysicalLayer] 📨 收到消息：${channel} = ${message.substring(0, 100)}...`);
        this._handleMessage(channel, message);
      });
      
      this.logger.info(`[PhysicalLayer] ✅ 订阅完成：${subscribeChannel}`);
      
      // 创建发布者（ioredis）- 使用独立连接避免阻塞
      this.publisher = new Redis(this.config.redisUrl);
      
      this.publisher.on('error', (err: Error) => {
        this.logger.error('[PhysicalLayer] Publisher 错误:', err);
      });
      
      await this.publisher.ping();
      this.logger.info('[PhysicalLayer] ✅ Publisher 已连接');
      
      this.connected = true;
      this.logger.info(`[PhysicalLayer] ✅ Physical Layer 已启动 (${Date.now() - startTime}ms)`);
      
    } catch (err) {
      this.logger.error('[PhysicalLayer] 启动失败:', err);
      this.connected = false;
      throw err;
    }
  }
  
  // ============================================
  // 📥 处理收到的消息
  // ============================================
  private _handleMessage(channel: string, message: string): void {
    if (!this.callbacks) return;
    
    this.logger.debug(`[PhysicalLayer] 📨 收到消息：${channel} → ${message.substring(0, 100)}...`);
    
    // 分发给 callbacks（由 Stack 处理）
    try {
      const result = this.callbacks.onMessage(channel, message);
      if (result instanceof Promise) {
        result.catch(err => {
          this.logger.error('[PhysicalLayer] onMessage 回调错误:', err);
        });
      }
    } catch (err) {
      this.logger.error('[PhysicalLayer] onMessage 回调异常:', err);
    }
  }
  
  // ============================================
  // 📤 发布消息
  // ============================================
  async publish(targetDeviceId: string, message: string): Promise<void> {
    if (!this.connected || !this.publisher) {
      throw new Error('PhysicalLayer not connected');
    }
    
    try {
      const account: RedisChannelAccountConfig = {
        enabled: true,
        redisUrl: this.config.redisUrl,
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
      };
      
      const publishChannel = getPublishChannel(account, targetDeviceId);
      await this.publisher.publish(publishChannel, message);
      
      this.logger.debug(`[PhysicalLayer] 📤 发布消息：${publishChannel}`);
      
    } catch (err) {
      this.logger.error('[PhysicalLayer] 发布失败:', err);
      throw err;
    }
  }
  
  // ============================================
  // 🛑 停止（断开连接、取消订阅）
  // ============================================
  async stop(): Promise<void> {
    this.connected = false;
    this.callbacks = null;
    
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe();
        await this.subscriber.quit();
      } catch (err) {
        this.logger.error('[PhysicalLayer] Subscriber 关闭失败:', err);
      }
      this.subscriber = null;
    }
    
    if (this.publisher) {
      try {
        await this.publisher.quit();
      } catch (err) {
        this.logger.error('[PhysicalLayer] Publisher 关闭失败:', err);
      }
      this.publisher = null;
    }
    
    this.logger.info('[PhysicalLayer] ✅ Physical Layer 已停止');
  }
  
  // ============================================
  // 📊 检查连接状态
  // ============================================
  isConnected(): boolean {
    return this.connected && !!this.subscriber && !!this.publisher;
  }
  
  // ============================================
  // 🔌 获取 Redis 客户端
  // ============================================
  getClient(): Redis | null {
    return this.publisher;
  }
}

// ============================================
// 📦 工厂函数
// ============================================
export function createPhysicalLayer(
  config: { redisUrl: string; deviceId: string; deviceName?: string },
  logger?: ILogger
): IPhysicalLayer {
  return new PhysicalLayerImpl(config, logger);
}
