/**
 * IP Layer Implementation
 * 
 * IP 层职责：
 * - 将 Redis 传来的 string 转换为定义的消息格式
 * - 装包：消息对象 → JSON string
 * - 拆包：JSON string → 消息对象
 * - 不关心协议细节，只做格式转换
 */

import { IPhysicalLayer } from '../physical-layer';
import { RedisChannelAccountConfig, getPublishChannel } from '../../lib/types';

// ============================================
// 📥 IP 层消息回调
// ============================================
export interface IpLayerCallbacks {
  // 收到消息（格式由上层判断）
  onMessage: (data: any) => void;
}

// ============================================
// 🔌 IP 层接口
// ============================================
export interface IPLayer {
  /**
   * 设置 PhysicalLayer（由外部注入）
   */
  setPhysicalLayer(physicalLayer: IPhysicalLayer): void;
  
  /**
   * 启动（注册回调）
   */
  start(callbacks: IpLayerCallbacks): void;
  
  /**
   * 解封装：Redis string → 消息对象
   * IP 层只负责格式转换，不判断协议类型
   */
  unpack(rawMessage: string): any;
  
  /**
   * 发送消息
   */
  send(targetDeviceId: string, data: any): Promise<void>;
  
  /**
   * 停止
   */
  stop(): void;
}

// ============================================
// 🎯 Redis IP 层实现
// ============================================
export class RedisIPLayer implements IPLayer {
  private config: {
    redisUrl: string;
    deviceId: string;
    deviceName?: string;
  };
  private physicalLayer: IPhysicalLayer | null = null;
  private callbacks: IpLayerCallbacks | null = null;
  
  constructor(config: { redisUrl: string; deviceId: string; deviceName?: string }) {
    this.config = config;
  }
  
  // ============================================
  // 🔌 设置 PhysicalLayer
  // ============================================
  setPhysicalLayer(physicalLayer: IPhysicalLayer): void {
    this.physicalLayer = physicalLayer;
  }
  
  // ============================================
  // 🚀 启动（注册回调）
  // ============================================
  start(callbacks: IpLayerCallbacks): void {
    this.callbacks = callbacks;
  }
  
  // ============================================
  // 📥 解封装：Redis string → 消息对象
  // IP 层只负责格式转换，不判断是什么协议
  // ============================================
  unpack(rawMessage: string): any {
    try {
      return JSON.parse(rawMessage);
    } catch (err) {
      console.error('[IP-Layer] 拆包失败:', err);
      return null;
    }
  }
  
  // ============================================
  // 📤 发送消息（装包）
  // 装包：消息对象 → JSON string
  // ============================================
  async send(targetDeviceId: string, data: any): Promise<void> {
    if (!this.physicalLayer) {
      throw new Error('IP-Layer: PhysicalLayer not set');
    }
    
    try {
      const message = JSON.stringify(data);
      console.log(`[IP-Layer] 📤 发送消息到：${targetDeviceId}, 消息：${message.substring(0, 100)}...`);
      await this.physicalLayer.publish(targetDeviceId, message);
      console.log(`[IP-Layer] ✅ 发送成功`);
    } catch (err) {
      console.error('[IP-Layer] 发送失败:', err);
      throw err;
    }
  }
  
  // ============================================
  // 🛑 停止
  // ============================================
  stop(): void {
    this.callbacks = null;
  }
}

// ============================================
// 📦 工厂函数
// ============================================
export function createIPLayer(config: { redisUrl: string; deviceId: string; deviceName?: string }): IPLayer {
  return new RedisIPLayer(config);
}
