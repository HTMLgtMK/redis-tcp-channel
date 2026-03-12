import util from 'util';
import type { ChannelLogSink } from 'openclaw/plugin-sdk';

// 定义统一的日志接口
export interface ILogger {
  info: (msg: string, ...args: any[]) => void;
  warn: (msg: string, ...args: any[]) => void;
  error: (msg: string, ...args: any[]) => void;
  debug: (msg: string, ...args: any[]) => void;
}

// 全局日志实现类，桥接到 OpenClaw 的日志系统
export class GlobalLogger implements ILogger {
  private channelLogSink?: ChannelLogSink;

  constructor(logger?: ChannelLogSink) {
    this.channelLogSink = logger;
  }

  // 更新日志后端
  updateLogger(logger?: ChannelLogSink) {
    this.channelLogSink = logger;
  }

  info(msg: string, ...args: any[]) {
    if (this.channelLogSink) {
      // ChannelLogSink.info only takes a single string parameter
      this.channelLogSink.info(`${msg} ${util.format(...args)}`);
    } else {
      console.info(`[INFO] ${msg}`, ...args);
    }
  }

  warn(msg: string, ...args: any[]) {
    if (this.channelLogSink) {
      // ChannelLogSink.warn only takes a single string parameter
      this.channelLogSink.warn(`${msg} ${util.format(...args)}`);
    } else {
      console.warn(`[WARN] ${msg}`, ...args);
    }
  }

  error(msg: string, ...args: any[]) {
    if (this.channelLogSink) {
      // ChannelLogSink.error only takes a single string parameter
      this.channelLogSink.error(`${msg} ${util.format(...args)}`);
    } else {
      console.error(`[ERROR] ${msg}`, ...args);
    }
  }

  debug(msg: string, ...args: any[]) {
    if (this.channelLogSink?.debug) {
      // ChannelLogSink.debug only takes a single string parameter
      this.channelLogSink.debug(`${msg} ${util.format(...args)}`);
    } else {
      // 如果 OpenClaw logger 不支持 debug，则降级到 console
      console.debug(`[DEBUG] ${msg}`, ...args);
    }
  }
}

// 创建全局单例日志实例
const globalLogger = new GlobalLogger();

export default globalLogger;