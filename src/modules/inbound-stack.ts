/**
 * Inbound Stack - 接收方专用栈
 * 
 * 职责：
 * - 监听所有设备的连接请求
 * - 处理传入的 SYN 握手
 * - 提取第一条消息（initialData）
 * - 分发给 Agent
 * 
 * 使用全局 TCP 连接池管理 TCPLayer
 */

import { IPhysicalLayer } from './physical-layer';
import { createIPLayer, IPLayer } from './ip-layer/ip-layer';
import { AppMessage, TcpSegment, TcpFlags, TCPLayer } from './tcp-layer/types';
import { TcpConnectionPool } from './tcp-layer/connection-pool';
import type { ILogger } from '../lib/logger';

// ============================================
// 🔌 Inbound Stack 接口
// ============================================
export interface InboundStack {
  setPhysicalLayer(physicalLayer: IPhysicalLayer): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(callback: (data: AppMessage) => void): void;
  sendMessage(data: AppMessage): Promise<void>;
}

// ============================================
// 🎯 Inbound Stack 实现
// ============================================
class InboundStackImpl implements InboundStack {
  private deviceId: string;
  private connectionId: string;
  private physicalLayer: IPhysicalLayer | null = null;
  private ipLayer: IPLayer;
  private messageCallback?: (data: AppMessage) => void;
  private logger: ILogger;
  private pool: TcpConnectionPool;
  private layers: Map<string, TCPLayer> = new Map();
  
  constructor(
    deviceId: string,
    connectionId: string,
    logger?: ILogger
  ) {
    this.deviceId = deviceId;
    this.connectionId = connectionId;
    this.logger = logger || {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: () => {},
    };
    
    this.ipLayer = createIPLayer({
      redisUrl: '',
      deviceId: this.deviceId,
    });
    
    this.pool = TcpConnectionPool.getInstance({
      logger: this.logger,
    });
  }
  
  setPhysicalLayer(physicalLayer: IPhysicalLayer): void {
    this.physicalLayer = physicalLayer;
    this.ipLayer.setPhysicalLayer(physicalLayer);
  }
  
  async start(): Promise<void> {
    this.ipLayer.start({
      onMessage: (data) => {
        this._tcpHandleMessage(data);
      },
    });
    
    if (this.physicalLayer) {
      const subscriber = (this.physicalLayer as any).subscriber as any;
      if (subscriber) {
        subscriber.on('message', (channel: string, message: string) => {
          this._handlePhysicalMessage(channel, message);
        });
        this.logger.info('[InboundStack] ✅ 已注册 PhysicalLayer 消息监听');
      }
    }
    
    this.logger.info('[InboundStack] ✅ 已启动，监听所有设备');
  }
  
  private _handlePhysicalMessage(channel: string, rawMessage: string): void {
    this.logger.info(`[InboundStack] 收到原始消息：${channel}`);
    
    const data = this.ipLayer.unpack(rawMessage);
    
    if (!data) {
      this.logger.info(`[InboundStack] 解封装失败，忽略`);
      return;
    }
    
    this.logger.info(`[InboundStack] 解封装成功：${JSON.stringify(data._tcp)}`);
    
    this._tcpHandleMessage(data);
  }
  
  private _tcpHandleMessage(data: any): void {
    if (!data._tcp || !data._tcp.connection_id) {
      this.logger.info(`[TCP-Layer] 非 TCP 消息，忽略`);
      return;
    }
    
    const segment: TcpSegment = data;
    const connectionId = segment._tcp.connection_id;
    const flags = segment._tcp.flags;
    const sourceDeviceId = segment._tcp.source_device_id;
    
    this.logger.info(`[TCP-Layer] Segment: connection_id=${connectionId}, flags=${flags.join(',')}`);
    
    const targetDeviceId = (flags.includes(TcpFlags.SYN) && !flags.includes(TcpFlags.ACK) && sourceDeviceId) 
      ? sourceDeviceId 
      : (connectionId.split('-').pop() || 'unknown');
    
    const tcpLayer = this.pool.getOrCreate({
      deviceId: this.deviceId,
      targetDeviceId: targetDeviceId,
      connectionId: connectionId,
      ipLayer: this.ipLayer,
      logger: this.logger,
    });
    
    if (flags.includes(TcpFlags.SYN) && !flags.includes(TcpFlags.ACK)) {
      this.logger.info(`[TCP-Layer] 处理 SYN 握手`);
      this._handleNewConnection(segment, tcpLayer);
    } else {
      this.logger.info(`[TCP-Layer] 转发给 TCP Layer`);
      
      // ⭐ 检查是否已注册回调，没有则注册
      if (!this.layers.has(connectionId)) {
        this.logger.info(`[InboundStack] 注册 Layer 回调`);
        tcpLayer.onData((msg) => {
          msg._connectionId = connectionId;
          this.logger.info(`[InboundStack] 📨 收到消息：${msg.data.text}`);
          if (this.messageCallback) {
            this.messageCallback(msg);
          }
        });
        this.layers.set(connectionId, tcpLayer);
      }
      
      tcpLayer.getIpLayerCallbacks().onMessage(segment);
    }
  }
  
  private _handleNewConnection(segment: TcpSegment, tcpLayer: TCPLayer): void {
    const connectionId = segment._tcp.connection_id;
    
    this.logger.info(`[InboundStack] 🆕 新连接请求：${connectionId}`);
    
    // 注册消息回调
    tcpLayer.onData((msg) => {
      msg._connectionId = connectionId;
      
      this.logger.info(`[InboundStack] 📨 收到消息：${msg.data.text}`);
      if (this.messageCallback) {
        this.messageCallback(msg);
      }
    });
    
    tcpLayer.start();
    tcpLayer.getIpLayerCallbacks().onMessage(segment);
  }
  
  async sendMessage(data: AppMessage): Promise<void> {
    const connectionId = data._connectionId;
    
    if (!connectionId) {
      throw new Error('sendMessage 需要指定 _connectionId');
    }
    
    const tcpLayer = this.layers.get(connectionId);
    
    if (!tcpLayer) {
      throw new Error(`连接不存在：${connectionId}`);
    }
    
    this.logger.info(`[InboundStack] 📤 发送回复到连接：${connectionId}`);
    
    await tcpLayer.send(data);
  }
  
  onMessage(callback: (data: AppMessage) => void): void {
    this.messageCallback = callback;
  }
  
  async stop(): Promise<void> {
    await this.pool.stop();
    this.ipLayer.stop();
    this.logger.info('[InboundStack] ✅ 已停止');
  }
}

export function createInboundStack(
  deviceId: string,
  connectionId: string,
  logger?: ILogger
): InboundStack {
  return new InboundStackImpl(deviceId, connectionId, logger);
}
