/**
 * Dev Server 启动器
 *
 * 用 child_process 启动项目的 dev server。
 * 返回 URL 给前端 iframe 用。
 */
import { spawn, ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger.js'

export interface DevServerHandle {
  url: string
  port: number
  process: ChildProcess
}

export class DevServerLauncher {
  private current: DevServerHandle | null = null

  /** 启动 dev server */
  async start(projectPath: string, framework: string): Promise<DevServerHandle> {
    // 先停掉旧的
    await this.stop()

    const port = this.detectPort(projectPath, framework)
    const cmd = this.detectCommand(projectPath, framework)

    if (!cmd) {
      throw new Error(`Cannot detect dev command for ${framework}`)
    }

    logger.info({ projectPath, cmd, port, framework }, 'Starting dev server')

    const proc = spawn(cmd.bin, cmd.args, {
      cwd: projectPath,
      shell: true,  // Windows 上 spawn .cmd 必须加 shell: true,否则 EINVAL
      env: {
        ...process.env,
        PORT: String(port),
        BROWSER: 'none',  // 防止自动打开浏览器
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,  // Windows 不弹黑框
    })

    proc.stdout?.on('data', (data) => {
      logger.debug({ output: data.toString() }, 'dev server stdout')
    })
    proc.stderr?.on('data', (data) => {
      logger.warn({ output: data.toString() }, 'dev server stderr')
    })

    // 等待端口启动
    await this.waitForPort(port, 30_000)

    const handle: DevServerHandle = {
      url: `http://localhost:${port}`,
      port,
      process: proc,
    }

    this.current = handle
    logger.info({ url: handle.url }, 'Dev server started')
    return handle
  }

  /** 停止 dev server */
  async stop(): Promise<void> {
    if (!this.current) return

    logger.info({ pid: this.current.process.pid }, 'Stopping dev server')
    this.current.process.kill()
    this.current = null
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  /** 获取当前 dev server */
  getCurrent(): DevServerHandle | null {
    return this.current
  }

  private detectPort(projectPath: string, framework: string): number {
    // 1. 优先用 package.json 的 port
    const pkgPath = join(projectPath, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const script = pkg.scripts?.dev || ''
      const match = script.match(/port[=\s]+(\d+)/i) || script.match(/-p\s+(\d+)/)
      if (match) return Number(match[1])
    }

    // 2. 框架默认端口
    if (framework.startsWith('Next.js')) return 3000
    if (framework.startsWith('Vite')) return 5173
    if (framework.startsWith('Nuxt')) return 3000

    return 3000
  }

  private detectCommand(_projectPath: string, _framework: string): { bin: string; args: string[] } | null {
    const isWin = process.platform === 'win32'
    const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm'

    // 优先 pnpm
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
