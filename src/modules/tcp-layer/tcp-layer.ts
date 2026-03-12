/**
 * TCP Layer Implementation
 * 
 * 传输层：在 IP 层之上提供可靠传输
 */

import { TCPLayer, TcpFlags, TcpState, TcpSegment, AppMessage, TcpConnection, TcpLayerConfig, ILogger } from './types';
import { IPLayer } from '../ip-layer/ip-layer';

// 重新导出类型，方便外部使用
export { TCPLayer, TcpFlags, TcpState, TcpSegment, AppMessage, TcpConnection, TcpLayerConfig, ILogger } from './types';

// ============================================
// ⚙️ 默认配置
// ============================================
const DEFAULT_CONFIG: TcpLayerConfig = {
  max_retransmit: 3,
  initial_timeout_ms: 5000,
  timeout_multiplier: 2,
  max_rounds: 15,
  window_size: 1,
};

// ============================================
// 🎯 TCP 层实现
// ============================================
export class TcpLayerImpl implements TCPLayer {
  private ipLayer: IPLayer;
  private deviceId: string;
  private targetDeviceId: string;
  private connectionId: string;
  
  private connection: TcpConnection | null = null;
  private isRunning: boolean = false;
  
  // 回调
  private onDataCallback?: (data: AppMessage) => void;
  private logger: ILogger;
  private config: TcpLayerConfig;
  
  constructor(
    deviceId: string,
    targetDeviceId: string,
    connectionId: string,
    ipLayer: IPLayer,
    logger?: ILogger,
    config?: Partial<TcpLayerConfig>
  ) {
    this.deviceId = deviceId;
    this.targetDeviceId = targetDeviceId;
    this.connectionId = connectionId;
    this.ipLayer = ipLayer;
    this.logger = logger || {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: () => {},
    };
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ============================================
  // 🚀 启动
  // ============================================
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.connection = this._createConnection();
    this.isRunning = true;
    this.logger.info('[TCP-Layer] 已启动');
    
    // 超时检查
    setInterval(() => this._checkTimeouts(), 2000);
  }
  
  // ============================================
  // 📥 接收数据（回调给应用层）
  // ============================================
  onData(callback: (data: AppMessage) => void): void {
    this.onDataCallback = callback;
  }
  
  // ============================================
  // 📥 获取 IP 层消息回调（由 Stack 内部调用）
  // ============================================
  getIpLayerCallbacks(): {
    onMessage: (segment: TcpSegment) => void;
    onDisconnect?: () => void;
  } {
    return {
      onMessage: (segment: TcpSegment) => {
        this.logger.info(`[TCP-Layer] 收到 Segment:`, {
          connection_id: segment._tcp.connection_id,
          expected: this.connectionId,
          match: segment._tcp.connection_id === this.connectionId,
        });
        this._handleIncoming(segment);
      },
      onDisconnect: () => {
        this.logger.info('[TCP-Layer] IP 层断联');
        // TCP 层清理状态
        if (this.connection) {
          this.connection.state = TcpState.CLOSED;
        }
      },
    };
  }
  
  // ============================================
  // 📤 发送数据（应用层调用）
  // ============================================
  async send(data: AppMessage): Promise<void> {
    if (!this.connection) throw new Error('TCP 层未启动');
    if (this.connection.state !== TcpState.ESTABLISHED) {
      throw new Error(`连接未建立：当前状态=${this.connection.state}`);
    }
    
    this.logger.info(`[TCP-Layer] 发送 DATA: ${JSON.stringify(data)}, seq=${this.connection.next_seq}`);
    const segment = this._createSegment([TcpFlags.DATA, TcpFlags.ACK], [data]);
    this.logger.info(`[TCP-Layer] Segment: seq=${segment._tcp.seq}, payload.length=${segment.payload.length}`);
    await this._sendSegment(segment);
    
    this.connection.next_seq++;
    this.connection.round_count++;
  }
  
  // ============================================
  // 🔗 发起连接
  // ============================================
  async connect(initialData?: AppMessage): Promise<void> {
    if (!this.connection) throw new Error('TCP 层未启动');
    if (this.connection.state !== TcpState.CLOSED) {
      throw new Error(`无法发起连接：当前状态=${this.connection.state}`);
    }
    
    this.connection.state = TcpState.SYN_SENT;
    this.connection.next_seq = 1;
    
    const payload = initialData ? [initialData] : [];
    const segment = this._createSegment([TcpFlags.SYN], payload);
    await this._sendSegment(segment);
    
    // ⭐ SYN 发送后递增 next_seq
    this.connection.next_seq++;
  }
  
  // ============================================
  // 🛑 关闭连接
  // ============================================
  async close(): Promise<void> {
    if (!this.connection || this.connection.state !== TcpState.ESTABLISHED) return;
    
    this.connection.state = TcpState.FIN_WAIT;
    const segment = this._createSegment([TcpFlags.FIN], []);
    await this._sendSegment(segment);
  }
  
  // ============================================
  // 🛑 停止
  // ============================================
  async stop(): Promise<void> {
    this.isRunning = false;
  }
  
  // ============================================
  // 📊 获取状态
  // ============================================
  getStatus(): any {
    if (!this.connection) return null;
    return {
      state: this.connection.state,
      rounds: this.connection.round_count,
      next_seq: this.connection.next_seq,
      expected_seq: this.connection.expected_seq,
    };
  }
  
  // ============================================
  // 🔧 内部方法
  // ============================================
  
  private _createConnection(): TcpConnection {
    return {
      connection_id: this.connectionId,
      state: TcpState.CLOSED,
      next_seq: Math.floor(Math.random() * 100) + 1,
      expected_seq: 1,
      pending_segment: null,
      retransmit_count: 0,
      last_send_time: null,
      timeout_ms: this.config.initial_timeout_ms,
      round_count: 0,
    };
  }
  
  private _createSegment(flags: TcpFlags[], payload: AppMessage[] = []): TcpSegment {
    return {
      _tcp: {
        connection_id: this.connectionId,
        seq: this.connection!.next_seq,
        ack: this.connection!.expected_seq,
        flags,
        timestamp: Date.now(),
        source_device_id: this.deviceId,  // 添加发送方设备 ID
      },
      payload,
    };
  }
  
  private async _sendSegment(segment: TcpSegment): Promise<void> {
    if (!this.connection) return;
    
    await this.ipLayer.send(this.targetDeviceId, segment);
    
    // 如果是 DATA，启动重传计时
    if (segment._tcp.flags.includes(TcpFlags.DATA)) {
      this.connection.pending_segment = segment;
      this.connection.last_send_time = Date.now();
    }
  }
  
  private _handleIncoming(segment: TcpSegment): void {
    if (!this.connection) {
      console.log('[TCP-Layer] ❌ connection 不存在');
      return;
    }
    if (segment._tcp.connection_id !== this.connectionId) {
      console.log(`[TCP-Layer] ❌ connection_id 不匹配：${segment._tcp.connection_id} !== ${this.connectionId}`);
      return;
    }
    
    const flags = segment._tcp.flags;
    const seq = segment._tcp.seq;
    
    console.log(`[TCP-Layer] 收到 Segment: flags=${flags.join(',')}, seq=${seq}, state=${this.connection.state}`);
    
    // SYN - 握手第 1 步（不携带数据）
    if (flags.includes(TcpFlags.SYN) && !flags.includes(TcpFlags.ACK)) {
      this.connection.state = TcpState.SYN_RCVD;
      this.connection.expected_seq = seq + 1;
      
      this.logger.info(`[TCP-Layer] 收到 SYN（纯握手）`);
      
      this._sendSynAck();  // 握手第 2 步
      return;
    }
    
    // SYN+ACK - 握手第 2 步（发起方接收）
    if (flags.includes(TcpFlags.SYN) && flags.includes(TcpFlags.ACK)) {
      this.logger.info(`[TCP-Layer] 收到 SYN+ACK，当前状态=${this.connection.state}`);
      
      if (this.connection.state === TcpState.SYN_SENT) {
        this.connection.state = TcpState.ESTABLISHED;
        this.connection.expected_seq = seq + 1;
        this.logger.info('[TCP-Layer] ✅ 握手完成（SYN+ACK 收到），发送 ACK');
        this._sendAck();  // 握手第 3 步
      }
      return;
    }
    
    // ACK - 握手第 3 步（接收方接收）
    if (flags.includes(TcpFlags.ACK) && !flags.includes(TcpFlags.SYN) && !flags.includes(TcpFlags.DATA)) {
      this.logger.info(`[TCP-Layer] 收到 ACK，当前状态=${this.connection.state}, seq=${seq}, expected=${this.connection.expected_seq}`);
      
      // ⭐ 允许 CLOSED → ESTABLISHED 转换（处理时序问题）
      if (this.connection.state === TcpState.SYN_RCVD || this.connection.state === TcpState.CLOSED) {
        if (seq === this.connection.expected_seq) {
          this.connection.state = TcpState.ESTABLISHED;
          this.logger.info('[TCP-Layer] ✅ 握手完成（ACK 收到），状态=ESTABLISHED');
          
          // ⭐ 同步更新外部状态（用于连接池检查）
          // 注意：这里无法直接访问 TcpConnection.state，需要在调用处同步
          
          return;
        }
      }
      
      return;
    }
    
    // DATA - 握手完成后的数据传输
    if (flags.includes(TcpFlags.DATA)) {
      // 标准 TCP：只允许 ESTABLISHED 状态接收 DATA
      if (this.connection.state !== TcpState.ESTABLISHED) {
        this.logger.warn(`[TCP-Layer] ⚠️ 连接未建立收到 DATA，状态=${this.connection.state}`);
        return;
      }
      
      if (seq === this.connection.expected_seq) {
        this.connection.expected_seq = seq + 1;
        
        // 清除重传 pending
        if (this.connection.pending_segment && 
            this.connection.pending_segment._tcp.seq === segment._tcp.ack - 1) {
          this.connection.pending_segment = null;
          this.connection.retransmit_count = 0;
          this.connection.timeout_ms = this.config.initial_timeout_ms;
        }
        
        // 回调给应用层
        this.logger.info(`[TCP-Layer] DATA 处理：onDataCallback=${!!this.onDataCallback}, payload.length=${segment.payload.length}`);
        if (this.onDataCallback && segment.payload.length > 0) {
          this.logger.info('[TCP-Layer] 📨 回调应用层消息');
          this.onDataCallback(segment.payload[0]);
        } else {
          this.logger.warn(`[TCP-Layer] ⚠️ 没有回调：onDataCallback=${!!this.onDataCallback}, payload.length=${segment.payload.length}`);
        }
      }
      this._sendAck();
      return;
    }
    
    // FIN
    if (flags.includes(TcpFlags.FIN)) {
      this.connection.state = TcpState.CLOSED;
      this._sendAck();
    }
  }
  
  private _sendSynAck(): void {
    if (!this.connection) return;
    this.connection.state = TcpState.ESTABLISHED;
    
    const segment = this._createSegment([TcpFlags.SYN, TcpFlags.ACK], []);
    this.logger.info('[TCP-Layer] 发送 SYN+ACK:', { seq: segment._tcp.seq, ack: segment._tcp.ack });
    this._sendSegment(segment);
    this.connection.next_seq++;
  }
  
  private _sendAck(): void {
    if (!this.connection) return;
    const segment = this._createSegment([TcpFlags.ACK], []);
    this.logger.info(`[TCP-Layer] 发送 ACK: targetDeviceId=${this.targetDeviceId}`);
    this._sendSegment(segment);
  }
  
  private _checkTimeouts(): void {
    if (!this.connection || !this.connection.pending_segment || !this.connection.last_send_time) return;
    
    const elapsed = Date.now() - this.connection.last_send_time;
    
    if (elapsed > this.connection.timeout_ms) {
      this.connection.retransmit_count++;
      
      if (this.connection.retransmit_count > this.config.max_retransmit) {
        this.connection.state = TcpState.CLOSED;
      } else {
        this.connection.timeout_ms *= this.config.timeout_multiplier;
        this.connection.last_send_time = Date.now();
        this._sendSegment(this.connection.pending_segment!);
      }
    }
  }
}

// ============================================
// 📦 工厂函数
// ============================================
export function createTCPLayer(
  deviceId: string,
  targetDeviceId: string,
  connectionId: string,
  ipLayer: IPLayer,
  logger?: ILogger,
  config?: Partial<TcpLayerConfig>
): TCPLayer {
  return new TcpLayerImpl(deviceId, targetDeviceId, connectionId, ipLayer, logger, config);
}
