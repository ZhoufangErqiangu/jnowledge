import { pino, type Logger } from 'pino'
import type { Config } from './config/index.js'

export type { Logger }

export function createLogger(config: Config): Logger {
  return pino({
    level: config.logLevel,
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino/file', options: { destination: 1 } } }
      : {}),
  })
}
