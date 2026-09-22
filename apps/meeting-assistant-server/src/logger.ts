/**
 * 轻量 logger(不用 pino,避免 Windows PowerShell GBK 编码乱码)
 *
 * 直接用 console.log,中文不乱码。
 */

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const

type Level = keyof typeof LEVELS

const currentLevel: Level = (process.env.LOG_LEVEL as Level) || 'info'

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel]
}

function format(level: Level, args: unknown[]): unknown[] {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const prefix = `[${ts}] [${level.toUpperCase()}]`

  // 如果第一个参数是 string,当作 message
  if (typeof args[0] === 'string') {
    return [`${prefix} ${args[0]}`, ...args.slice(1)]
  }
  // 否则是对象 + message
  if (args.length >= 2 && typeof args[1] === 'string') {
    return [`${prefix} ${args[1]}`, args[0], ...args.slice(2)]
  }
  // 只有对象
  return [`${prefix}`, args[0], ...args.slice(1)]
}

export const logger = {
  debug(...args: unknown[]): void {
    if (!shouldLog('debug')) return
    console.debug(...format('debug', args))
  },
  info(...args: unknown[]): void {
    if (!shouldLog('info')) return
    console.log(...format('info', args))
  },
  warn(...args: unknown[]): void {
    if (!shouldLog('warn')) return
    console.warn(...format('warn', args))
  },
  error(...args: unknown[]): void {
    if (!shouldLog('error')) return
    console.error(...format('error', args))
  },
}
