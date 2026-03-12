/**
 * Session Service - 会话管理业务逻辑
 * 
 * 负责：
 * - 管理 TCP 会话（创建、复用、清理）
 * - 发送消息
 * - 会话超时清理
 * 
 * 架构说明：
 * - Inbound Stack: 在 gateway.startAccount 时启动，持续监听传入消息
 * - Outbound Stacks: 按需创建，用于发送消息到特定目标
 */

import { createRedisChannelStack, RedisChannelStack, IPhysicalLayer } from '../modules';
import { AppMessage } from '../modules/tcp-layer/types';
import { RedisChannelAccountConfig } from '../lib/types';

// ============================================
// 📊 会话信息
// ============================================
export interface SessionInfo {
  stack: RedisChannelStack;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
}

// ============================================
// 🎯 会话服务
// ============================================
export class SessionService {
  private sessions: Map<string, SessionInfo> = new Map();
  private cleanupInterval?: NodeJS.Timeout;
  
  // PhysicalLayer（长连接，在 gateway.startAccount 时设置）
  private physicalLayer?: IPhysicalLayer;
  
  // Inbound Stack（在 gateway.startAccount 时设置）
  public inboundStack?: RedisChannelStack;
  
  constructor() {
    // 启动定期清理（每 60 秒检查一次）
    this.startCleanup();
  }
  
  // ============================================
  // 📥 设置 PhysicalLayer（由 gateway.startAccount 调用）
  // ============================================
  setPhysicalLayer(layer: IPhysicalLayer): void {
    this.physicalLayer = layer;
    console.log('[SessionService] PhysicalLayer 已设置');
  }
  
  // ============================================
  // 📥 设置 Inbound Stack（由 gateway.startAccount 调用）
  // ============================================
  setInboundStack(stack: RedisChannelStack): void {
    this.inboundStack = stack;
    console.log('[SessionService] Inbound Stack 已设置');
  }
  
  // ============================================
  // 📤 发送消息
  // ============================================
  async sendMessage(
    account: RedisChannelAccountConfig,
    targetDeviceId: string,
    sessionKey: string,
    text: string
  ): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
      // 检查会话是否存在
      const existingSession = this.sessions.get(sessionKey);
      
      // 获取或创建会话（如果是新会话，传递第一条消息）
      const session = await this.getOrCreateSession(account, targetDeviceId, sessionKey, !existingSession ? text : undefined);
      
      // 如果是复用会话，需要发送消息
      if (existingSession) {
        // 创建应用层消息
        const appMessage: AppMessage = {
          type: 'message',
          data: { 
            text, 
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        };
        
        // 发送消息
        await session.stack.sendMessage(appMessage);
        
        // 更新会话信息
        session.lastActivity = Date.now();
        session.messageCount++;
      } else {
        // 新会话，消息已在 initialMessage 中发送
        session.lastActivity = Date.now();
        // messageCount 已在创建时设置为 1
      }
      
      return {
        ok: true,
        id: `tcp-${sessionKey}`,
      };
      
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
  
  // ============================================
  // 🔑 获取或创建会话
  // ============================================
  private async getOrCreateSession(
    account: RedisChannelAccountConfig,
    targetDeviceId: string,
    sessionKey: string,
    firstMessage?: string
  ): Promise<SessionInfo> {
    let session = this.sessions.get(sessionKey);
    
    if (!session) {
      // 创建新会话
      const connectionId = `tcp-${sessionKey}`;
      
      // 如果有第一条消息，作为 initialMessage 在 TCP 握手时发送
      const initialMessage = firstMessage ? {
        type: 'message',
        data: { 
          text: firstMessage, 
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      } : undefined;
      
      const stack = createRedisChannelStack({
        deviceId: account.deviceId,
        targetDeviceId,
        connectionId,
        isInitiator: true,
        initialMessage,
      });
      
      // 注入 PhysicalLayer（如果已设置）
      if (this.physicalLayer) {
        stack.setPhysicalLayer(this.physicalLayer);
      }
      
      // 启动 Stack
      await stack.start();
      
      session = {
        stack,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: initialMessage ? 1 : 0,
      };
      
      this.sessions.set(sessionKey, session);
      console.log(`[SessionService] 创建新会话：${sessionKey}`);
    } else {
      console.log(`[SessionService] 复用会话：${sessionKey}`);
    }
    
    return session;
  }
  
  // ============================================
  // 🧹 定期清理超时会话
  // ============================================
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const timeoutMs = 300000;  // 5 分钟
      
      for (const [key, session] of this.sessions.entries()) {
        if (now - session.lastActivity > timeoutMs) {
          this.closeSession(key).catch(console.error);
        }
      }
    }, 60000);  // 每 60 秒检查一次
  }
  
  // ============================================
  // 🛑 关闭会话
  // ============================================
  async closeSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (session) {
      try {
        await session.stack.stop();
        console.log(`[SessionService] 关闭会话：${sessionKey}`);
      } catch (err) {
        console.error(`[SessionService] 关闭会话失败：${sessionKey}`, err);
      } finally {
        this.sessions.delete(sessionKey);
      }
    }
  }
  
  // ============================================
  // 🛑 停止服务
  // ============================================
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // 关闭所有会话
    for (const key of this.sessions.keys()) {
      this.closeSession(key).catch(console.error);
    }
  }
  
  // ============================================
  // 📊 获取会话统计
  // ============================================
  getStats(): {
    totalSessions: number;
    sessions: Array<{
      key: string;
      createdAt: number;
      lastActivity: number;
      messageCount: number;
    }>;
  } {
    const sessions: Array<any> = [];
    for (const [key, session] of this.sessions.entries()) {
      sessions.push({
        key,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        messageCount: session.messageCount,
      });
    }
    
    return {
      totalSessions: this.sessions.size,
      sessions,
    };
  }
}

// ============================================
// 📦 单例
// ============================================
let defaultSessionService: SessionService | null = null;

export function getSessionService(): SessionService {
  if (!defaultSessionService) {
    defaultSessionService = new SessionService();
  }
  return defaultSessionService;
}
