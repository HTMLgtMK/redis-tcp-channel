import { RedisChannelAccountConfig } from './types';
import type { ILogger } from './logger';

export interface HeartbeatDeps {
  redisClient: any;
  config: RedisChannelAccountConfig;
  logger: ILogger;
}

export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private deps: HeartbeatDeps;

  constructor(deps: HeartbeatDeps) {
    this.deps = deps;
  }

  /**
   * 启动心跳
   * @param interval 心跳间隔（毫秒），默认 20000ms
   */
  start(interval?: number): void {
    if (this.timer) {
      this.stop();
    }

    const heartbeatInterval = interval ?? this.deps.config.heartbeatInterval ?? 20000;

    this.timer = setInterval(async () => {
      try {
        const { redisClient, config, logger } = this.deps;
        if (redisClient && config) {
          const key = `devices:${config.deviceId}:heartbeat`;
          const value = Date.now().toString();
          // Use SETEX for maximum compatibility (Redis 2.6+)
          // SETEX key seconds value - works with ioredis
          await redisClient.setex(key, 60, value);
          logger.debug?.(`💓 Heartbeat sent for device: ${config.deviceId}`);
        }
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        this.deps.logger.error?.(`❌ Heartbeat failed: ${err}`);
      }
    }, heartbeatInterval);

    this.deps.logger.info?.(`💓 Heartbeat started (interval: ${heartbeatInterval}ms)`);
  }

  /**
   * 停止心跳
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.deps.logger.info?.(`💓 Heartbeat stopped`);
    }
  }
}
