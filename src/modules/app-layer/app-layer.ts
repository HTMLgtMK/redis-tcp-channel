/**
 * Application Layer Implementation
 * 
 * 应用层：处理业务逻辑，与 agent 集成
 */

import { TCPLayer } from '../tcp-layer/types';
import { AppMessage } from '../tcp-layer/types';

// ============================================
// 🎯 应用层接口
// ============================================
export interface AppLayer {
  /**
   * 启动
   */
  start(): Promise<void>;
  
  /**
   * 发送消息（webchat/agent 调用）
   */
  sendMessage(data: AppMessage): Promise<void>;
  
  /**
   * 接收消息（回调给 agent）
   */
  onMessage(callback: (data: AppMessage) => void): void;
  
  /**
   * 连接建立
   */
  onConnected(callback: () => void): void;
  
  /**
   * 连接断开
   */
  onDisconnected(callback: () => void): void;
  
  /**
   * 关闭
   */
  close(): Promise<void>;
  
  /**
   * 停止
   */
  stop(): Promise<void>;
  
  /**
   * 获取状态
   */
  getStatus(): any;
}

// ============================================
// 🎯 应用层实现
// ============================================
export class AppLayerImpl implements AppLayer {
  private tcpLayer: TCPLayer;
  private messageCallback?: (data: AppMessage) => void;
  private connectedCallback?: () => void;
  private disconnectedCallback?: () => void;
  private isInitiator: boolean;
  private initialData?: AppMessage;
  
  constructor(
    tcpLayer: TCPLayer,
    isInitiator?: boolean,
    initialData?: AppMessage
  ) {
    this.tcpLayer = tcpLayer;
    this.isInitiator = isInitiator || false;
    this.initialData = initialData;
  }
  
  // ============================================
  // 🚀 启动（注册 TCP 层回调）
  // ============================================
  async start(): Promise<void> {
    // 注册 TCP 层回调，接收处理后的应用层消息
    this.tcpLayer.onData((data: AppMessage) => {
      if (this.messageCallback) {
        this.messageCallback(data);
      }
    });
    
    // 启动 TCP 层
    await this.tcpLayer.start();
    
    // 如果是发起方，先握手，握手完成后再发送 initialData
    if (this.isInitiator) {
      // ⭐ 纯握手，不携带数据
      await this.tcpLayer.connect();
      
      // ⭐ 等待握手完成后发送 initialData
      if (this.initialData) {
        // 等待 1 秒让 ACK 到达（实际应该用事件通知）
        await new Promise(r => setTimeout(r, 1000));
        await this.tcpLayer.send(this.initialData);
      }
    }
  }
  
  // ============================================
  // 📤 发送消息（webchat/agent 调用）
  // ============================================
  async sendMessage(data: AppMessage): Promise<void> {
    await this.tcpLayer.send(data);
  }
  
  // ============================================
  // 📥 接收消息（回调给 agent）
  // ============================================
  onMessage(callback: (data: AppMessage) => void): void {
    this.messageCallback = callback;
  }
  
  onConnected(callback: () => void): void {
    this.connectedCallback = callback;
  }
  
  onDisconnected(callback: () => void): void {
    this.disconnectedCallback = callback;
  }
  
  // ============================================
  // 🔌 关闭
  // ============================================
  async close(): Promise<void> {
    await this.tcpLayer.close();
  }
  
  // ============================================
  // 🛑 停止
  // ============================================
  async stop(): Promise<void> {
    await this.tcpLayer.stop();
  }
  
  // ============================================
  // 📊 获取状态
  // ============================================
  getStatus(): any {
    return this.tcpLayer.getStatus();
  }
}

// ============================================
// 📦 工厂函数
// ============================================
export function createAppLayer(
  tcpLayer: TCPLayer,
  isInitiator?: boolean,
  initialData?: AppMessage
): AppLayer {
  return new AppLayerImpl(tcpLayer, isInitiator, initialData);
}
