import type {
  ChannelPlugin
} from 'openclaw/plugin-sdk/channels/plugins/types.plugin';
import type { OpenClawPluginApi as ChannelPluginAPI } from 'openclaw/plugin-sdk';
import type {
  OpenClawConfig,
  ChannelGatewayContext,
  ChannelOutboundContext,
  ChannelOutboundAdapter,
  ChannelCapabilities,
  ChannelMeta,
  ChannelConfigSchema,
  ChannelConfigAdapter
} from 'openclaw/plugin-sdk';
import type { ChannelStatusAdapter, ChannelStatusIssue, ChannelAccountSnapshot } from 'openclaw/plugin-sdk/channels/plugins/types';

import { RedisClientManager } from './lib/redis-client';
import { handleInboundMessage, MessageHandlerDeps } from './lib/message-handler';
import { sendOutboundMessage, SendResult } from './lib/message-sender';
import { RedisChannelAccountConfig, getSubscribeChannel, getPublishChannel, NormalizedMessage } from './lib/types';
import { HeartbeatManager } from './lib/heartbeat';
import globalLogger, { type ILogger } from './lib/logger';
import { handleInboundMessageDispatch } from './lib/message-dispatcher';

// 业务逻辑层
import { getSessionService } from './business/session-service';
import type { AppMessage } from './modules/tcp-layer/types';

// 获取会话服务单例
const sessionService = getSessionService();

// Get version from package.json
const VERSION = require('../package.json').version;

// Debug logger - only outputs when DEBUG env var includes 'redis-channel'
function debugLog(message: string): void {
  if (process.env.DEBUG?.includes('redis-channel')) {
    console.log(`[redis-channel-debug] ${message}`);
  }
}

export const redisChannelPlugin: ChannelPlugin<RedisChannelAccountConfig> = {
  id: 'redis-channel',

  meta: {
    id: 'redis-channel',
    label: `Redis Channel v${VERSION}`,
    selectionLabel: 'Redis Pub/Sub Channel',
    docsPath: '/plugins/redis-channel',
    blurb: `Custom messaging via Redis Pub/Sub mechanism (v${VERSION})`,
    aliases: ['redis', 'redis-pubsub'],
    icon: 'database',
  } as ChannelMeta,

  capabilities: {
    chatTypes: ['direct', 'group'],
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
    effects: false,
    groupManagement: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false,
    polls: false,
  } as ChannelCapabilities,

  messaging: {
    targetResolver: {
      hint: "Use device ID (e.g., 'node-sub-1', 'node-parent')",
      looksLikeId: (raw: string, normalized?: string): boolean => {
        const trimmed = raw.trim();
        if (!trimmed) return false;
        if (/^node-/.test(trimmed)) return true;
        if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return true;
        return false;
      },
    },
  },

  configSchema: {
    schema: {
      type: 'object',
      properties: {
        redisUrl: {
          type: 'string',
          title: 'Redis URL',
          description: 'The connection URL for the Redis server (e.g., redis://localhost:6379).',
        },
        deviceId: {
          type: 'string',
          title: 'Device ID',
          description: 'Unique device identifier.',
        },
        deviceName: {
          type: 'string',
          title: 'Device Name',
          description: 'Device display name.',
        },
        heartbeatInterval: {
          type: 'number',
          title: 'Heartbeat Interval',
          description: 'Heartbeat interval in milliseconds (default: 20000)',
          default: 20000,
        },
        subscribeChannel: {
          type: 'string',
          title: 'Subscribe Channel',
          description: 'The Redis channel to subscribe to for incoming messages. Defaults to openclaw:device:<deviceId>.',
        },
        publishChannel: {
          type: 'string',
          title: 'Publish Channel',
          description: 'The Redis channel to publish outgoing messages. Defaults to openclaw:device:<targetDeviceId>.',
        },
        senderNamePrefix: {
          type: 'string',
          title: 'Sender Name Prefix',
          description: 'Prefix to add to sender names',
        },
        messageFormat: {
          type: 'string',
          enum: ['json', 'text'],
          title: 'Message Format',
          description: 'Format for messages (default: json)',
          default: 'json',
        },
        targetSession: {
          type: 'string',
          title: 'Target Session',
          description: 'Session ID to route messages to (default: agent:main:main)',
          default: 'agent:main:main',
        },
        autoExecute: {
          type: 'boolean',
          title: 'Auto Execute',
          description: 'Automatically execute commands in received messages (default: false)',
          default: false,
        },
        showSenderPrefix: {
          type: 'boolean',
          title: 'Show Sender Prefix',
          description: 'Add [Sender] prefix to message text (default: true)',
          default: true,
        },
      },
      required: ['redisUrl', 'deviceId'],
    },
  } as ChannelConfigSchema,

  config: {
    listAccountIds: (cfg: OpenClawConfig) => {
      const accounts = cfg.channels?.['redis-channel']?.accounts ?? {};
      return Object.keys(accounts).filter(id => accounts[id]?.enabled !== false);
    },

    resolveAccount: (cfg: OpenClawConfig, accountId?: string): RedisChannelAccountConfig | undefined => {
      const accounts = cfg.channels?.['redis-channel']?.accounts ?? {};
      const account = accountId ? accounts[accountId] : Object.values(accounts)[0] as RedisChannelAccountConfig;
      return account?.enabled ? account : undefined;
    },

    isEnabled: (account: RedisChannelAccountConfig, cfg: OpenClawConfig): boolean => {
      return account?.enabled !== false;
    },

    isConfigured: async (account: RedisChannelAccountConfig, cfg: OpenClawConfig): Promise<boolean> => {
      return !!(account?.redisUrl && account?.deviceId);
    },
  } as ChannelConfigAdapter<RedisChannelAccountConfig>,

  outbound: {
    deliveryMode: 'direct',
    textChunkLimit: 10000,

    resolveTarget: (params: {
      cfg?: any;
      to?: string;
      allowFrom?: string[];
      accountId?: string | null;
      mode?: any;
    }) => {
      // For redis-channel, target is the target device ID (e.g., 'node-parent')
      // We accept any non-empty string as a valid target
      const { to } = params;
      debugLog(`resolveTarget called with: ${JSON.stringify({ to, accountId: params.accountId })}`);
      
      if (!to || typeof to !== 'string' || to.trim() === '') {
        debugLog(`resolveTarget: REJECTED - empty target`);
        return {
          ok: false,
          error: new Error('Target device ID is required'),
        };
      }
      debugLog(`resolveTarget: ACCEPTED - ${to.trim()}`);
      return {
        ok: true,
        to: to.trim(),
      };
    },

    sendText: async (ctx: ChannelOutboundContext & { account?: RedisChannelAccountConfig }): Promise<any> => {
      const { text, to, accountId, cfg } = ctx as any;
      
      debugLog(`sendText called: to=${to}, accountId=${accountId || 'MISSING'}`);
      
      // Get account from cfg using accountId, or use first available account
      let account: RedisChannelAccountConfig | undefined;
      const accounts = cfg?.channels?.['redis-channel']?.accounts;
      
      if (accounts) {
        if (accountId && accounts[accountId]) {
          account = accounts[accountId];
          debugLog(`Account loaded by accountId: ${accountId}`);
        } else {
          // No accountId or not found, use first available account
          const accountIds = Object.keys(accounts);
          if (accountIds.length > 0) {
            account = accounts[accountIds[0]];
            debugLog(`Using first available account: ${accountIds[0]}`);
          }
        }
      }
      
      // Validate account config
      if (!account) {
        console.error(`[redis-channel] sendText: No redis-channel account configured`);
        console.error(`  - accountId: ${accountId || 'MISSING'}`);
        console.error(`  - cfg.channels['redis-channel'].accounts: ${accounts ? JSON.stringify(Object.keys(accounts)) : 'MISSING'}`);
        return {
          ok: false,
          error: 'No redis-channel account configured',
        };
      }
      
      if (!account.redisUrl || !account.deviceId) {
        console.error(`[redis-channel] sendText: INVALID ACCOUNT CONFIG`);
        console.error(`  - account.redisUrl: ${account.redisUrl || 'MISSING'}`);
        console.error(`  - account.deviceId: ${account.deviceId || 'MISSING'}`);
        return {
          ok: false,
          error: 'Account configuration missing: redisUrl or deviceId not set',
        };
      }
      
      // Extract target from 'to' field
      const target = { id: to }; 
      
      const startTime = Date.now();
      
      try {
        // 全部使用 TCP 可靠传输
        const ctxAny = ctx as any;
        
        // 直接使用 OpenClaw 的 SessionKey（OpenClaw 自动维护多轮对话）
        const sessionKey = ctxAny.SessionKey || `session-${Date.now()}`;
        
        debugLog(`TCP 传输：target=${to}, SessionKey=${sessionKey}`);
        
        // 调用业务逻辑层发送消息
        const result = await sessionService.sendMessage(
          account,
          to,
          sessionKey,
          text
        );
        
        const elapsed = Date.now() - startTime;
        debugLog(`sendOutboundMessage completed in ${elapsed}ms: ok=${result.ok}, id=${result.id}`);
        
        if (result.ok) {
          console.log(`[redis-channel] ✅ Message sent successfully to ${to}`);
          // Return proper OutboundDeliveryResult format
          return {
            ok: true as const,
            id: result.id || `redis-${Date.now()}`,
            channel: 'redis-channel',
            to: to,
            accountId: accountId || 'default',
          };
        } else {
          console.error(`[redis-channel] ❌ Message send failed: ${result.error}`);
          return {
            ok: false as const,
            error: result.error || 'Unknown error sending message',
          };
        }
      } catch (err) {
        const elapsed = Date.now() - startTime;
        console.error(`[redis-channel] ❌ sendOutboundMessage threw exception after ${elapsed}ms:`, err);
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : 'Unknown exception',
        };
      }
    },

    // sendMedia is required by OpenClaw core's createPluginHandler
    // redis-channel doesn't support media, so we return an error
    sendMedia: async (ctx: ChannelOutboundContext & { account?: RedisChannelAccountConfig } & { mediaUrl: string }): Promise<any> => {
      const { to, accountId, cfg, mediaUrl } = ctx as any;
      
      // Get account from cfg using accountId (same as sendText)
      let account: RedisChannelAccountConfig | undefined;
      const accounts = cfg?.channels?.['redis-channel']?.accounts;
      
      if (accounts) {
        if (accountId && accounts[accountId]) {
          account = accounts[accountId];
        } else {
          const accountIds = Object.keys(accounts);
          if (accountIds.length > 0) {
            account = accounts[accountIds[0]];
          }
        }
      }
      
      if (!account) {
        return {
          ok: false as const,
          error: 'No redis-channel account configured',
        };
      }
      
      debugLog(`sendMedia called (not supported)`);
      return {
        ok: false as const,
        error: 'Media not supported by redis-channel',
      };
    },
  } as ChannelOutboundAdapter,

  gateway: {
    startAccount: async (params: ChannelGatewayContext<RedisChannelAccountConfig>) => {
      const { cfg, accountId, account: redisConfig, abortSignal, log } = params;
      
      const startTime = Date.now();
      debugLog(`startAccount called at ${new Date().toISOString()}, accountId=${accountId}`);

      // Update the global logger with the OpenClaw logger
      globalLogger.updateLogger(log);
      debugLog(`Logger updated (${Date.now() - startTime}ms)`);

      const subscribeChannel = getSubscribeChannel(redisConfig);
      debugLog(`subscribeChannel: ${subscribeChannel} (${Date.now() - startTime}ms)`);

      globalLogger.info(`[${accountId}] 🔌 Starting Redis channel v${VERSION}: ${subscribeChannel}`);

      const handlerDeps: MessageHandlerDeps = {
        logger: globalLogger,
        emitMessage: async (msg: NormalizedMessage) => {
          await handleInboundMessageDispatch({
            msg,
            params,
            redisConfig
          });
        }
      };

      // ============================================
      // 🚀 Physical Layer + Stack 架构
      // ============================================
      debugLog(`Creating PhysicalLayer... (${Date.now() - startTime}ms)`);
      
      // 导入新模块
      const { createPhysicalLayer } = require('./lib/physical-layer');
      const { createRedisChannelStack } = require('./modules');
      const { getSessionService } = require('./business/session-service');
      
      // 1. 创建 PhysicalLayer（长连接，整个插件生命周期）
      const physicalLayer = createPhysicalLayer({
        redisUrl: redisConfig.redisUrl,
        deviceId: redisConfig.deviceId,
        deviceName: redisConfig.deviceName,
      }, globalLogger);
      
      // 2. 启动 PhysicalLayer
      await physicalLayer.start({
        onMessage: (channel: string, message: string) => {
          // 消息分发逻辑：根据 connectionId 路由到对应的 Stack
          // 简化处理：所有消息都传递给 Inbound Stack
          debugLog(`PhysicalLayer 收到消息：${channel}`);
        },
        onDisconnect: () => {
          globalLogger.warn(`[${accountId}] 🔴 PhysicalLayer 断联`);
        }
      });
      
      globalLogger.info(`[${accountId}] ✅ PhysicalLayer 已启动`);
      
      // 3. 创建 Inbound Stack（监听所有设备）
      const inboundStack = createRedisChannelStack({
        deviceId: redisConfig.deviceId,
        targetDeviceId: '*',  // 监听所有设备
        connectionId: `inbound-${redisConfig.deviceId}`,
        isInitiator: false,
      });
      
      // 4. 注入 PhysicalLayer
      inboundStack.setPhysicalLayer(physicalLayer);
      
      // 5. 注册消息回调
      inboundStack.onMessage(async (appMessage: AppMessage) => {
        globalLogger.info(`[${accountId}] 📨 收到消息：${JSON.stringify(appMessage.data)}`);
        
        const normalizedMsg: NormalizedMessage = {
          id: `tcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          channel: 'redis-tcp-channel',
          accountId: accountId,
          senderId: appMessage.data.senderId || 'unknown',
          senderName: appMessage.data.senderName || 'Unknown User',
          text: appMessage.data.text || '',
          timestamp: appMessage.timestamp,
          isGroup: false,
          groupId: undefined,
          metadata: appMessage.data,
        };
        
        await handlerDeps.emitMessage(normalizedMsg);
      });
      
      // 6. 启动 Inbound Stack
      await inboundStack.start();
      globalLogger.info(`[${accountId}] ✅ Inbound Stack 已启动`);
      
      // 7. 保存到 SessionService
      const sessionService = getSessionService();
      sessionService.setPhysicalLayer(physicalLayer);
      sessionService.setInboundStack(inboundStack);
      
      const publishChannel = getPublishChannel(redisConfig, redisConfig.deviceId);
      globalLogger.info(`[${accountId}] ✅ Redis channel connected: ${subscribeChannel} → ${publishChannel}`);
      debugLog(`publishChannel: ${publishChannel} (${Date.now() - startTime}ms)`);

      // Track if we're shutting down
      let isShuttingDown = false;

      // Store the promise to prevent premature resolution
      const stopFunction = async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        
        globalLogger.info(`[${accountId}] 🔌 Stopping Redis channel: ${subscribeChannel}`);
        
        // 停止 Inbound Stack
        try {
          if (sessionService.inboundStack) {
            await sessionService.inboundStack.stop();
            globalLogger.info(`[${accountId}] ✅ Inbound Stack 已停止`);
          }
        } catch (err) {
          globalLogger.error(`[${accountId}] Error stopping inbound stack: ${err}`);
        }
        
        // 停止 PhysicalLayer
        try {
          // PhysicalLayer 需要从 sessionService 获取，或者保存在闭包中
          // 这里简单处理：通过 inboundStack 获取
          globalLogger.info(`[${accountId}] ✅ PhysicalLayer 将停止`);
        } catch (err) {
          globalLogger.error(`[${accountId}] Error stopping physical layer: ${err}`);
        }
        
        globalLogger.info(`[${accountId}] ✅ Redis channel disconnected`);
      };
      
      debugLog(`Waiting for abort signal... (${Date.now() - startTime}ms)`);
      // Keep the channel running by returning a promise that resolves only when stopped
      // @see https://github.com/openclaw/openclaw/issues/19854
      await new Promise<void>((resolve) => {
        if (isShuttingDown) { resolve(); return; }
        abortSignal?.addEventListener('abort', ()=>{
          stopFunction();
          resolve();
        }, { once: true });
      });
      debugLog(`Abort signal received, shutting down (${Date.now() - startTime}ms)`);

      debugLog(`Returning channel object... (${Date.now() - startTime}ms)`);
      return {
        stop: stopFunction,

        health: async () => {
          try {
            // 通过 PhysicalLayer 检查健康状态
            return { status: 'ok', latency: Date.now() };
          } catch (err) {
            return {
              status: 'error',
              error: err instanceof Error ? err.message : 'Unknown',
            };
          }
        },
      };
    },
  },

  status: {
    defaultRuntime: {
      accountId: '',
      enabled: true,
      configured: true,
      linked: true,
      running: true,
      connected: true,
      lastConnectedAt: null,
      lastMessageAt: null,
      lastEventAt: null,
      lastError: null,
      lastStartAt: null,
      lastStopAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      mode: 'normal',
      dmPolicy: 'open',
      allowFrom: [],
      tokenSource: 'config',
      botTokenSource: 'config',
      appTokenSource: 'config',
      credentialSource: 'config',
      secretSource: 'config',
      audienceType: 'public',
      audience: 'all',
      webhookPath: '',
      webhookUrl: '',
      baseUrl: '',
      allowUnmentionedGroups: true,
      cliPath: null,
      dbPath: null,
      port: null,
      probe: {},
      lastProbeAt: null,
      audit: {},
      application: {},
      bot: {},
      publicKey: null,
      profile: {},
      channelAccessToken: '',
      channelSecret: ''
    },

    async probeAccount({ account, timeoutMs = 10000 }) {
      try {
        const client = await RedisClientManager.getClient(account);
        
        // Test connection by pinging Redis
        const startTime = Date.now();
        await client.ping();
        const responseTime = Date.now() - startTime;
        
        // Test if we can access the subscribe channel
        const subscribeChannel = getSubscribeChannel(account);
        // Just verify we can interact with Redis, no need to actually subscribe here
        
        return {
          ok: true,
          responseTime,
          serverInfo: await client.info(), // Get Redis server info
          channels: {
            subscribe: subscribeChannel,
            publish: getPublishChannel(account, account.deviceId)
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async auditAccount({ account, timeoutMs = 15000 }) {
      try {
        const client = await RedisClientManager.getClient(account);
        
        // Get detailed Redis info
        const serverInfo = await client.info();
        const config = await client.config('GET', '*');
        
        // Get client list to see current connections
        const clientListStr = await client.client('LIST') as string;
        const clientList = clientListStr ? clientListStr.split('\n').filter((line: string) => line.trim()) : [];
        
        // Check for heartbeat key existence
        const heartbeatKey = `devices:${account.deviceId}:heartbeat`;
        const heartbeatExists = await client.exists(heartbeatKey);
        
        return {
          server: {
            info: serverInfo,
            config: config,
            connectedClients: clientList.length,
          },
          channels: {
            subscribe: getSubscribeChannel(account),
            publish: getPublishChannel(account, account.deviceId),
          },
          heartbeat: {
            key: heartbeatKey,
            exists: Boolean(heartbeatExists),
          },
          capabilities: {
            pubsub: true,
            keyspaceNotifications: true,
          }
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async buildAccountSnapshot({ account, cfg, runtime, probe, audit }) {
      const snapshot = {
        accountId: account.deviceId,
        name: account.deviceName || account.deviceId,
        enabled: account.enabled !== false,
        configured: !!(account.redisUrl && account.deviceId),
        linked: true, // Redis connection established
        running: runtime?.running || false,
        connected: runtime?.connected || false,
        reconnectAttempts: runtime?.reconnectAttempts || 0,
        lastConnectedAt: runtime?.lastConnectedAt || null,
        lastMessageAt: runtime?.lastMessageAt || null,
        lastEventAt: runtime?.lastEventAt || null,
        lastError: runtime?.lastError || null,
        lastStartAt: runtime?.lastStartAt || null,
        lastStopAt: runtime?.lastStopAt || null,
        lastInboundAt: runtime?.lastInboundAt || null,
        lastOutboundAt: runtime?.lastOutboundAt || null,
        mode: account.deviceName || 'normal',
        dmPolicy: 'open',
        allowFrom: [],
        tokenSource: 'config',
        botTokenSource: 'config',
        appTokenSource: 'config',
        credentialSource: 'config',
        secretSource: 'config',
        audienceType: 'public',
        audience: 'all',
        webhookPath: '',
        webhookUrl: '',
        baseUrl: '',
        allowUnmentionedGroups: true,
        cliPath: null,
        dbPath: null,
        port: null,
        probe: probe || {},
        lastProbeAt: runtime?.lastProbeAt || null,
        audit: audit || {},
        application: {},
        bot: {},
        publicKey: null,
        profile: {},
        channelAccessToken: '',
        channelSecret: '',
        // Redis-specific fields
        redisUrl: account.redisUrl,
        deviceId: account.deviceId,
        subscribeChannel: getSubscribeChannel(account),
        publishChannel: getPublishChannel(account, account.deviceId),
        heartbeatInterval: account.heartbeatInterval || 20000,
      };

      return snapshot;
    },

    collectStatusIssues(accounts) {
      const issues: ChannelStatusIssue[] = [];
      
      for (const account of accounts) {
        // Check if account is properly configured
        if (!(account as any).redisUrl) {
          issues.push({
            channel: 'redis-channel',
            accountId: (account as any).deviceId,
            kind: 'config',
            message: `Redis URL not configured for device ${(account as any).deviceId}`,
            fix: 'Set redisUrl in account configuration'
          });
        }
        
        if (!(account as any).deviceId) {
          issues.push({
            channel: 'redis-channel',
            accountId: (account as any).deviceId,
            kind: 'config',
            message: 'Device ID not configured',
            fix: 'Set deviceId in account configuration'
          });
        }
        
        // Check if account is enabled
        if ((account as any).enabled === false) {
          issues.push({
            channel: 'redis-channel',
            accountId: (account as any).deviceId,
            kind: 'config',
            message: `Account ${(account as any).deviceId} is disabled`,
            fix: 'Set enabled: true in account configuration'
          });
        }
      }
      
      return issues;
    }
  },
};

export type { RedisChannelAccountConfig };