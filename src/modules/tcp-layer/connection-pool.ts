/**
 * TCP Connection Pool - 全局 TCP 连接池
 * 
 * 直接管理 TCPLayer 实例，不再有 TcpConnection 包装层
 * 
 * 使用方式:
 *   const pool = TcpConnectionPool.getInstance();
 *   const tcpLayer = pool.getOrCreate(connectionId, config);
 *   await pool.send(tcpLayer, data);
 */

import { TCPLayer, TcpState, AppMessage, TcpSegment } from './types';
import { createTCPLayer } from './tcp-layer';
import { IPLayer } from '../ip-layer/ip-layer';
import type { ILogger } from '../../lib/logger';

// ============================================
// 🔧 连接配置
// ============================================
export interface TcpLayerConfig {
  deviceId: string;
  targetDeviceId: string;
  connectionId: string;
  ipLayer: IPLayer;
  logger?: ILogger;
}

// ============================================
// 📊 连接池统计
// ============================================
export interface PoolStats {
  totalLayers: number;
  activeLayers: number;
  idleLayers: number;
  layers: Array<{
    connectionId: string;
    state: TcpState;
    lastActivity: number;
  }>;
}

// ============================================
// 🎯 TCP Connection Pool 类（全局单例）
// ============================================
export class TcpConnectionPool {
  private static instance: TcpConnectionPool;
  
  // 直接管理 TCPLayer
  private layers: Map<string, TCPLayer> = new Map();
  private lastActivity: Map<string, number> = new Map();
  private config: {
    idleTimeout: number;
    cleanupInterval: number;
    maxConnections: number;
    logger: ILogger;
  };
  private cleanupIntervalId?: NodeJS.Timeout;
  
  // 私有构造函数（单例模式）
  private constructor(config: {
    idleTimeout?: number;
    cleanupInterval?: number;
    maxConnections?: number;
    logger?: ILogger;
  } = {}) {
    this.config = {
      idleTimeout: config.idleTimeout ?? 300000,  // 5 分钟
      cleanupInterval: config.cleanupInterval ?? 60000,  // 1 分钟
      maxConnections: config.maxConnections ?? 1000,
      logger: config.logger || {
        info: console.log,
        warn: console.warn,
        error: console.error,
        debug: () => {},
      },
    };
    
    // 启动超时清理
    this.startCleanup();
    
    this.config.logger.info('[TcpConnectionPool] ✅ 连接池已初始化');
  }
  
  // ============================================
  // 📦 获取全局单例
  // ============================================
  static getInstance(config?: {
    idleTimeout?: number;
    cleanupInterval?: number;
    maxConnections?: number;
    logger?: ILogger;
  }): TcpConnectionPool {
    if (!this.instance) {
      this.instance = new TcpConnectionPool(config);
    }
    return this.instance;
  }
  
  // ============================================
  // 🔑 获取或创建 TCPLayer（核心方法）
  // ============================================
  getOrCreate(config: TcpLayerConfig): TCPLayer {
    const { connectionId, deviceId, targetDeviceId, ipLayer, logger } = config;
    
    const existing = this.layers.get(connectionId);
    
    // ✅ Layer 存在，复用
    if (existing) {
      this.config.logger.debug(`[TCP Pool] ♻️ 复用 Layer：${connectionId}`);
      this.lastActivity.set(connectionId, Date.now());
      return existing;
    }
    
    // ❌ Layer 不存在，新建
    this.config.logger.debug(`[TCP Pool] 🆕 新建 Layer：${connectionId}`);
    
    // 检查连接数限制
    if (this.layers.size >= this.config.maxConnections) {
      this.config.logger.warn(`[TCP Pool] ⚠️ 连接数已达上限：${this.config.maxConnections}`);
      this.cleanupIdleLayers();
    }
    
    // 创建 TCPLayer
    const tcpLayer = createTCPLayer(
      deviceId,
      targetDeviceId,
      connectionId,
      ipLayer,
      logger
    );
    
    this.layers.set(connectionId, tcpLayer);
    this.lastActivity.set(connectionId, Date.now());
    
    return tcpLayer;
  }
  
  // ============================================
  // 📤 发送消息
  // ============================================
  async send(tcpLayer: TCPLayer, data: AppMessage): Promise<void> {
    await tcpLayer.send(data);
  }
  
  // ============================================
  // 🛑 关闭并移除 Layer
  // ============================================
  async remove(connectionId: string): Promise<void> {
    const tcpLayer = this.layers.get(connectionId);
    
    if (tcpLayer) {
      await tcpLayer.close();
      this.layers.delete(connectionId);
      this.lastActivity.delete(connectionId);
      this.config.logger.debug(`[TCP Pool] 🗑️ Layer 已移除：${connectionId}`);
    }
  }
  
  // ============================================
  // 📊 获取连接池统计
  // ============================================
  getStats(): PoolStats {
    const layers: Array<{
      connectionId: string;
      state: TcpState;
      lastActivity: number;
    }> = [];
    
    let activeCount = 0;
    let idleCount = 0;
    
    for (const [id, layer] of this.layers.entries()) {
      const status = layer.getStatus();
      const lastAct = this.lastActivity.get(id) || 0;
      
      layers.push({
        connectionId: id,
        state: status.state,
        lastActivity: lastAct,
      });
      
      if (status.state === TcpState.ESTABLISHED) {
        activeCount++;
      } else {
        idleCount++;
      }
    }
    
    return {
      totalLayers: this.layers.size,
      activeLayers: activeCount,
      idleLayers: idleCount,
      layers,
    };
  }
  
  // ============================================
  // 🧹 启动超时清理
  // ============================================
  private startCleanup(): void {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupIdleLayers();
    }, this.config.cleanupInterval);
    
    this.config.logger.debug(`[TCP Pool] ⏰ 超时清理已启动（${this.config.idleTimeout}ms）`);
  }
  
  // ============================================
  // 🧹 清理超时空闲 Layer
  // ============================================
  private cleanupIdleLayers(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, layer] of this.layers.entries()) {
      const lastAct = this.lastActivity.get(id) || 0;
      const idleTime = now - lastAct;
      
      if (idleTime > this.config.idleTimeout) {
        this.config.logger.debug(`[TCP Pool] 🗑️ 清理超时 Layer：${id} (空闲 ${idleTime}ms)`);
        layer.close().catch(err => {
          this.config.logger.error(`[TCP Pool] 关闭 Layer 失败：${id}`, err);
        });
        this.layers.delete(id);
        this.lastActivity.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.config.logger.info(`[TCP Pool] 🧹 清理完成：${cleaned} 个 Layer`);
    }
  }
  
  // ============================================
  // 🛑 停止连接池
  // ============================================
  async stop(): Promise<void> {
    // 停止清理定时器
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
    
    // 关闭所有 Layer
    const closePromises: Promise<void>[] = [];
    for (const [id, layer] of this.layers.entries()) {
      closePromises.push(
        layer.close().catch(err => {
          this.config.logger.error(`[TCP Pool] 关闭 Layer 失败：${id}`, err);
        })
      );
    }
    
    await Promise.all(closePromises);
    this.layers.clear();
    this.lastActivity.clear();
    
    this.config.logger.info('[TCP Pool] 🛑 连接池已停止');
  }
}
