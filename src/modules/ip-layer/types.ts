/**
 * IP Layer Types
 * 
 * IP 层：Redis Pub/Sub，只管收发
 */

// ============================================
// 📦 IP 层消息（原始消息，在 Redis 中传输）
// ============================================
export interface IpMessage {
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: number;
  isGroup?: boolean;
  groupId?: string;
  messageId?: string;
  metadata?: Record<string, any>;
}

// ============================================
// 🔌 IP 层接口
// ============================================
export interface IPLayer {
  /**
   * 初始化（连接 Redis）
   */
  initialize(): Promise<void>;
  
  /**
   * 发送消息（TCP 层调用）
   * @param targetDeviceId 目标设备 ID
   * @param message 消息内容
   */
  send(targetDeviceId: string, message: IpMessage): Promise<void>;
  
  /**
   * 订阅接收（TCP 层回调）
   * @param deviceId 本地设备 ID
   * @param callback 接收回调
   */
  onReceive(deviceId: string, callback: (message: IpMessage) => void): void;
  
  /**
   * 关闭
   */
  close(): Promise<void>;
}

// ============================================
// ⚙️ IP 层配置
// ============================================
export interface IpLayerConfig {
  redisUrl: string;
  deviceId: string;
  deviceName?: string;
}
