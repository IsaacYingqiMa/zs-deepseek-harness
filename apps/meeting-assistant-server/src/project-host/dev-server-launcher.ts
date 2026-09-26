/**
 * Dev Server 启动器
 *
 * 按项目类型分流:
 *   - framework: 用 child_process 启动 pnpm dev
 *   - pure-html: 用 node 内置 http 提供静态文件服务(无需 npm install)
 *
 * 返回 URL 给前端 iframe 用。
 *
 * package.json parsing happens over user-supplied project files; we treat
 * the result as a typed view of `unknown` JSON at the seam.
 */
/* eslint-disable typescript/no-unnecessary-condition,
   typescript/no-confusing-void-expression,
   typescript/no-floating-promises,
   typescript/no-unsafe-assignment,
   typescript/no-unsafe-member-access,
   typescript/no-unsafe-call */
import { spawn, ChildProcess } from 'child_process'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, extname, normalize } from 'path'
import http from 'http'
import net from 'net'
import { logger } from '../logger.js'
import type { ProjectType } from './project-scanner.js'

export interface DevServerHandle {
  url: string
  port: number
  process: ChildProcess | { kill: () => void }
}

/** 纯 HTML 服务的起始端口(自动找可用端口,从这个值开始递增) */
const PURE_HTML_PORT_START = 4100
/** 最多尝试 N 个端口 */
const MAX_PORT_ATTEMPTS = 10
/** 入口文件名(优先级最高) */
const PRIMARY_ENTRY = 'index.html'
const SECONDARY_ENTRY = 'index.htm'

/** MIME 类型映射(给静态服务用) */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

export class DevServerLauncher {
  private current: DevServerHandle | null = null
  private currentServer: http.Server | null = null

  /**
   * 启动 dev server
   * @param type 项目类型,决定走哪条启动路径
   */
  async start(
    projectPath: string,
    framework: string,
    type: ProjectType = 'framework',
  ): Promise<DevServerHandle> {
    // 先停掉旧的
    await this.stop()

    if (type === 'pure-html') {
      return this.startPureHtmlServer(projectPath)
    }
    return this.startFrameworkDevServer(projectPath, framework)
  }

  /** 框架项目:启动 pnpm dev */
  private async startFrameworkDevServer(projectPath: string, framework: string): Promise<DevServerHandle> {
    const port = this.detectPort(projectPath, framework)
    const cmd = this.detectCommand()

    logger.info({ projectPath, cmd, port, framework }, 'Starting framework dev server')

    const proc = spawn(cmd.bin, cmd.args, {
      cwd: projectPath,
      shell: true,
      env: {
        ...process.env,
        PORT: String(port),
        BROWSER: 'none',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    proc.stdout?.on('data', (data) => {
      logger.debug({ output: data.toString() }, 'dev server stdout')
    })
    proc.stderr?.on('data', (data) => {
      logger.warn({ output: data.toString() }, 'dev server stderr')
    })

    await this.waitForPort(port, 30_000)

    const handle: DevServerHandle = {
      url: `http://localhost:${port}`,
      port,
      process: proc,
    }
    this.current = handle
    logger.info({ url: handle.url }, 'Framework dev server started')
    return handle
  }

  /**
   * 纯 HTML 项目:用 node http 提供静态文件
   *
   * 优势:
   *   - 启动 < 1s(无 npm install)
   *   - 不需要任何外部命令
   *   - 支持 SPA 路由(index.html fallback)
   *   - 端口从 4100 开始自动找可用端口
   */
  private async startPureHtmlServer(projectPath: string): Promise<DevServerHandle> {
    const root = normalize(projectPath)
    const port = await this.findAvailablePort(PURE_HTML_PORT_START, MAX_PORT_ATTEMPTS)

    // ★ 检测入口 HTML 文件:优先 index.html,否则找浅层第一个 .html
    const entryHtml = this.detectEntryHtml(root)
    if (!entryHtml) {
      throw new Error(`No HTML file found in ${projectPath}`)
    }
    logger.info({ entryHtml, projectPath }, 'Pure HTML entry file detected')

    return new Promise<DevServerHandle>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        // 解析请求路径(防止目录穿越)
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
        const filePath = normalize(join(root, urlPath === '/' ? `/${entryHtml}` : urlPath))

        // 安全检查:必须在项目根目录内
        if (!filePath.startsWith(root)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden')
          return
        }

        // 处理 SPA 路由:找不到 .html 时 fallback 到 index.html
        const finishWith = (data: Buffer, mime: string) => {
          res.writeHead(statusCode, { 'Content-Type': mime, 'Cache-Control': 'no-cache' })
          res.end(data)
        }

        let statusCode = 200
        readFileOrFallback(filePath, root, (err, data) => {
          if (err) {
            statusCode = 404
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('Not Found')
            return
          }
          const ext = extname(filePath).toLowerCase()
          // readFileOrFallback 保证 error 时回退到 index.html,所以一定有 data
          if (data !== undefined) {
            finishWith(data, MIME_TYPES[ext] || 'application/octet-stream')
          }
        })
      })

      server.on('error', reject)

      server.listen(port, () => {
        const handle: DevServerHandle = {
          url: `http://localhost:${port}`,
          port,
          process: { kill: () => server.close() },
        }
        this.current = handle
        this.currentServer = server
        logger.info({ url: handle.url, projectPath }, 'Pure HTML server started')
        resolve(handle)
      })
    })
  }

  /**
   * 从 startPort 开始,找一个可用的端口
   * (EADDRINUSE 时 +1 重试,最多 attempts 次)
   */
  private async findAvailablePort(startPort: number, attempts: number): Promise<number> {
    for (let i = 0; i < attempts; i++) {
      const port = startPort + i
      if (await this.isPortAvailable(port)) {
        return port
      }
      logger.warn({ port, attempt: i + 1 }, 'Port in use, skipping')
    }
    throw new Error(`No available port found in range ${startPort}-${startPort + attempts - 1}`)
  }

  /**
   * 检测纯 HTML 项目的入口文件
   *
   * 优先级:
   *   1. <root>/index.html
   *   2. <root>/index.htm
   *   3. 浅层(<root>/ 直接子文件)的第一个 .html 文件
   *
   * @returns 入口文件名(相对于 root),找不到返回 null
   */
  private detectEntryHtml(root: string): string | null {
    // 优先级 1 & 2
    if (existsSync(join(root, PRIMARY_ENTRY))) return PRIMARY_ENTRY
    if (existsSync(join(root, SECONDARY_ENTRY))) return SECONDARY_ENTRY

    // 优先级 3:扫浅层找第一个 .html
    try {
      const items = readdirSync(root)
      const firstHtml = items.find(item =>
        item.toLowerCase().endsWith('.html') || item.toLowerCase().endsWith('.htm'),
      )
      return firstHtml ?? null
    } catch (err) {
      logger.warn({ err, root }, 'detectEntryHtml failed')
      return null
    }
  }

  /** 检测端口是否可用(监听所有接口,与 http server.listen 行为一致) */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net.createServer()
      tester.once('error', () => resolve(false))
      tester.once('listening', () => {
        tester.close(() => resolve(true))
      })
      // 不指定 host,默认监听 '::'(IPv6 + IPv4),与 http server.listen(port) 行为一致
      tester.listen(port)
    })
  }

  /** 停止 dev server(同时支持 child_process 和 http.Server) */
  async stop(): Promise<void> {
    if (!this.current) return

    logger.info({ pid: 'current' }, 'Stopping dev server')

    if (this.currentServer) {
      this.currentServer.close()
      this.currentServer = null
    } else {
      try {
        this.current.process.kill()
      } catch (err) {
        logger.warn({ err }, 'failed to kill dev server process')
      }
    }
    this.current = null
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  /** 获取当前 dev server */
  getCurrent(): DevServerHandle | null {
    return this.current
  }

  private detectPort(projectPath: string, framework: string): number {
    const pkgPath = join(projectPath, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const script = pkg.scripts?.dev || ''
      const match = script.match(/port[=\s]+(\d+)/i) || script.match(/-p\s+(\d+)/)
      if (match) return Number(match[1])
    }
    if (framework.startsWith('Next.js')) return 4100
    if (framework.startsWith('Vite')) return 5173
    if (framework.startsWith('Nuxt')) return 4100
    return 4100
  }

  private detectCommand(): { bin: string; args: string[] } {
    const isWin = process.platform === 'win32'
    const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm'
    return { bin: pnpmCmd, args: ['dev'] }
  }

  private async waitForPort(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const reachable = await this.checkPort(port)
      if (reachable) return
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(`Dev server didn't start within ${timeoutMs}ms on port ${port}`)
  }

  private async checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      import('http').then(({ get }) => {
        const req = get(`http://localhost:${port}`, (res: { statusCode?: number; resume(): void }) => {
          resolve(res.statusCode !== undefined)
          res.resume()
        })
        req.on('error', () => resolve(false))
        req.setTimeout(1000, () => {
          req.destroy()
          resolve(false)
        })
      })
    })
  }
}

/**
 * 读取文件,失败时 fallback 到 index.html(SPA 路由)
 */
function readFileOrFallback(
  filePath: string,
  root: string,
  cb: (err: NodeJS.ErrnoException | null, data?: Buffer) => void,
) {
  import('fs').then(({ readFile }) => {
    readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback:找不到 .html 时返回 index.html
        if (extname(filePath) === '' || extname(filePath) === '.html') {
          readFile(join(root, 'index.html'), cb)
          return
        }
        cb(err)
        return
      }
      cb(null, data)
    })
  })
}
