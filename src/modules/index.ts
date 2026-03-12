/**
 * Redis Channel Modules
 * 
 * 四层架构：
 * - Physical Layer: Redis 连接（长连接，插件生命周期）
 * - IP Layer: 装包/拆包
 * - TCP Layer: seq/ack、可靠传输
 * - Application Layer: 业务逻辑
 */

// ============================================
// 🌐 Physical Layer
// ============================================
export {
  IPhysicalLayer,
  PhysicalLayerImpl,
  createPhysicalLayer,
  PhysicalLayerCallbacks,
} from './physical-layer';

// ============================================
// 📥 Inbound Stack (接收方专用)
// ============================================
export {
  InboundStack,
  createInboundStack,
} from './inbound-stack';

// ============================================
// 🌐 IP Layer
// ============================================
export {
  IPLayer,
  IpMessage,
  IpLayerConfig,
} from './ip-layer/types';

export {
  RedisIPLayer,
  createIPLayer,
} from './ip-layer/ip-layer';

// ============================================
// 🚚 TCP Layer
// ============================================
export {
  TCPLayer,
  TcpFlags,
  TcpState,
  TcpSegment,
  AppMessage,
  TcpConnection as TcpConnectionInterface,
  ILogger,
} from './tcp-layer/types';

export {
  TcpLayerImpl,
  createTCPLayer,
} from './tcp-layer/tcp-layer';

// ============================================
// 🏊 TCP Connection Pool (全局连接池)
// ============================================
export {
  TcpConnectionPool,
  TcpLayerConfig,
  PoolStats,
} from './tcp-layer/connection-pool';

// ============================================
// 💼 Application Layer
// ============================================
export {
  AppLayer,
  AppLayerImpl,
  createAppLayer,
} from './app-layer/app-layer';

// ============================================
// 🎯 简化 API - 完整栈
// ============================================
import { IPhysicalLayer } from './physical-layer';
import { createIPLayer, IPLayer } from './ip-layer/ip-layer';
import { createTCPLayer, TCPLayer, AppMessage, TcpSegment } from './tcp-layer/tcp-layer';
import { createAppLayer, AppLayer } from './app-layer/app-layer';

export interface RedisChannelStackConfig {
  deviceId: string;
  targetDeviceId: string;
  connectionId: string;
  isInitiator?: boolean;
  initialMessage?: AppMessage;
}

// ============================================
// 🔌 Stack 接口（统一入口 - 完全封装内部细节）
// ============================================
export interface RedisChannelStack {
  /**
   * 设置 PhysicalLayer（由外部注入）
   */
  setPhysicalLayer(physicalLayer: IPhysicalLayer): void;
  
  /**
   * 启动（注册回调）
   */
  start(): Promise<void>;
  
  /**
   * 停止
   */
  stop(): Promise<void>;
  
  /**
   * 设置消息回调（收到消息时传给 Agent）
   */
  onMessage(callback: (data: AppMessage) => void): void;
  
  /**
   * 发送消息
   */
  sendMessage(data: AppMessage): Promise<void>;
}

// ============================================
// 🎯 Stack 实现（完全封装内部细节）
// ============================================
class RedisChannelStackImpl implements RedisChannelStack {
  // 私有成员
  private ipLayer: IPLayer;
  private tcpLayer: TCPLayer;
  private appLayer: AppLayer;
  private config: RedisChannelStackConfig;
  private physicalLayer: IPhysicalLayer | null = null;
  
  constructor(config: RedisChannelStackConfig) {
    this.config = config;
    
    // 1. 创建 IP 层
    this.ipLayer = createIPLayer({
      redisUrl: '',  // 不再需要，由 PhysicalLayer 提供
      deviceId: config.deviceId,
    });
    
    // 2. 创建 TCP 层
    this.tcpLayer = createTCPLayer(
      config.deviceId,
      config.targetDeviceId,
      config.connectionId,
      this.ipLayer
    );
    
    // 3. 创建应用层
    this.appLayer = createAppLayer(
      this.tcpLayer,
      config.isInitiator,
      config.initialMessage
    );
  }
  
  // ============================================
  // 🔌 设置 PhysicalLayer
  // ============================================
  setPhysicalLayer(physicalLayer: IPhysicalLayer): void {
    this.physicalLayer = physicalLayer;
    this.ipLayer.setPhysicalLayer(physicalLayer);
  }
  
  // ============================================
  // 🚀 启动
  // ============================================
  async start(): Promise<void> {
    // 1. ⭐ 先监听 PhysicalLayer 的入站消息（在一切之前）
    if (this.physicalLayer) {
      const subscriber = (this.physicalLayer as any).subscriber as any;
      if (subscriber) {
        subscriber.on('message', (channel: string, message: string) => {
          // 解封装并传递给 TCP Layer
          const data = this.ipLayer.unpack(message);
          if (data && data._tcp) {
            // ⭐ 同步更新 TcpConnection.state
            const connAny = this.tcpLayer as any;
            if (connAny.connection && connAny.connection.state === 'ESTABLISHED') {
              // 连接已建立，更新外部状态
            }
            
            this.tcpLayer.getIpLayerCallbacks().onMessage(data);
          }
        });
      }
    }
    
    // 2. 启动 IP 层（注册回调）
    this.ipLayer.start({
      onMessage: (segment: TcpSegment) => {
        // IP 层收到消息 → 传递给 TCP 层
        this.tcpLayer.getIpLayerCallbacks().onMessage(segment);
      },
    });
    
    // 3. 启动应用层（注册 TCP 层回调，发起连接）
    await this.appLayer.start();
  }
  
  // ============================================
  // 🛑 停止
  // ============================================
  async stop(): Promise<void> {
    // 停止应用层
    await this.appLayer.stop();
    // 停止 IP 层
    this.ipLayer.stop();
  }
  
  // ============================================
  // 📥 设置消息回调
  // ============================================
  onMessage(callback: (data: AppMessage) => void): void {
    this.appLayer.onMessage(callback);
  }
  
  // ============================================
  // 📤 发送消息
  // ============================================
  async sendMessage(data: AppMessage): Promise<void> {
    await this.appLayer.sendMessage(data);
  }
}

// ============================================
// 📦 工厂函数
// ============================================
export function createRedisChannelStack(config: RedisChannelStackConfig): RedisChannelStack {
  return new RedisChannelStackImpl(config);
}
