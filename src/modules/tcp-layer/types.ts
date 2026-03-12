/**
 * TCP Layer Types
 * 
 * 传输层：seq/ack、可靠传输
 */

// ============================================
// 📦 TCP 标志
// ============================================
export enum TcpFlags {
  SYN = 'SYN',
  ACK = 'ACK',
  FIN = 'FIN',
  DATA = 'DATA',
}

// ============================================
// 📋 连接状态
// ============================================
export enum TcpState {
  CLOSED = 'CLOSED',
  SYN_SENT = 'SYN_SENT',
  SYN_RCVD = 'SYN_RCVD',
  ESTABLISHED = 'ESTABLISHED',
  FIN_WAIT = 'FIN_WAIT',
  CLOSE_WAIT = 'CLOSE_WAIT',
}

// ============================================
// 📨 TCP Segment（IP 层消息的 payload）
// ============================================
export interface TcpSegment {
  _tcp: {
    connection_id: string;
    seq: number;
    ack: number;
    flags: TcpFlags[];
    timestamp: number;
    source_device_id?: string;  // 发送方设备 ID（用于回复）
  };
  payload: any[];
}

// ============================================
// 📊 应用层消息（TCP 层传输的数据）
// ============================================
export interface AppMessage {
  type: string;
  data: any;
  timestamp: number;
  _connectionId?: string;  // 连接 ID（内部使用，用于回复）
}

// ============================================
// 🔗 连接上下文
// ============================================
export interface TcpConnection {
  connection_id: string;
  state: TcpState;
  next_seq: number;
  expected_seq: number;
  pending_segment: TcpSegment | null;
  retransmit_count: number;
  last_send_time: number | null;
  timeout_ms: number;
  round_count: number;
}

// ============================================
// ⚙️ TCP 层配置
// ============================================
export interface TcpLayerConfig {
  max_retransmit: number;
  initial_timeout_ms: number;
  timeout_multiplier: number;
  max_rounds: number;
  window_size: number;
}

// ============================================
// 📝 日志接口
// ============================================
export interface ILogger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

// ============================================
// 🔌 TCP 层接口
// ============================================
export interface TCPLayer {
  /**
   * 启动
   */
  start(): Promise<void>;
  
  /**
   * 停止
   */
  stop(): Promise<void>;
  
  /**
   * 发送数据（应用层调用）
   */
  send(data: AppMessage): Promise<void>;
  
  /**
   * 接收数据（回调给应用层）
   */
  onData(callback: (data: AppMessage) => void): void;
  
  /**
   * 连接建立
   */
  connect(initialData?: AppMessage): Promise<void>;
  
  /**
   * 关闭连接
   */
  close(): Promise<void>;
  
  /**
   * 获取状态
   */
  getStatus(): any;
  
  /**
   * 获取 IP 层回调（由 IP 层调用）
   */
  getIpLayerCallbacks(): {
    onMessage: (segment: TcpSegment) => void;
    onDisconnect?: () => void;
  };
}
