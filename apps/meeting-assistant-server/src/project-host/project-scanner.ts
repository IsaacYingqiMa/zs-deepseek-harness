/**
 * 项目扫描器
 *
 * 扫描预设目录,识别可改造的项目。
 *
 * 识别策略:
 *   1. 找 package.json
 *   2. 从 package.json 推断框架(Next.js / Vite / CRA / Nuxt)
 *   3. 检查是否有 shadcn/ui
 *   4. 返回项目列表
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger.js'
import type { ProjectInfo } from '../types/task.js'

/** package.json 的最小形状(框架探测用) */
interface PackageJsonLike {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: { dev?: string; start?: string }
}

export class ProjectScanner {
  /** 扫描所有预设目录,返回项目列表 */
  scan(dirs: string[]): ProjectInfo[] {
    const projects: ProjectInfo[] = []
    for (const dir of dirs) {
      try {
        if (!existsSync(dir)) continue
        projects.push(...this.scanDir(dir, 3)) // 深度 3,避免扫太深
      } catch (err) {
        logger.warn({ err, dir }, 'Failed to scan directory')
      }
    }
    return projects
  }

  /** 扫描单个目录 */
  private scanDir(dir: string, depth: number): ProjectInfo[] {
    if (depth <= 0) return []

    const projects: ProjectInfo[] = []

    try {
      const items = readdirSync(dir)

      for (const item of items) {
        // 跳过常见不需要的目录
        if (['node_modules', '.git', '.next', 'dist', 'build', '.DS_Store'].includes(item)) continue

        const fullPath = join(dir, item)

        try {
          const stat = statSync(fullPath)
          if (!stat.isDirectory()) continue

          // 检查是否是项目根(package.json)
          const pkgPath = join(fullPath, 'package.json')
          if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
            const framework = this.detectFramework(pkg)
            if (framework) {
              projects.push({
                name: item,
                path: fullPath,
                framework,
                hasShadcn: this.hasShadcn(fullPath),
                previewPort: this.detectPreviewPort(pkg),
              })
              continue // 不再下钻
            }
          }

          // 否则递归下钻
          projects.push(...this.scanDir(fullPath, depth - 1))
        } catch {
          // 单个 item 错误,继续
        }
      }
    } catch (err) {
      logger.warn({ err, dir }, 'scanDir failed')
    }

    return projects
  }

  /** 从 package.json 检测框架 */
  private detectFramework(pkg: PackageJsonLike): string | null {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    if (deps['next']) return `Next.js ${deps['next']}`
    if (deps['nuxt']) return `Nuxt ${deps['nuxt']}`
    if (deps['@sveltejs/kit']) return 'SvelteKit'
    if (deps['vite'] && deps['react']) return 'Vite + React'
    if (deps['vite'] && deps['vue']) return 'Vite + Vue'
    if (deps['react-scripts']) return 'Create React App'
    if (deps['vue']) return 'Vue CLI'

    return null
  }

  /** 是否使用 shadcn/ui */
  private hasShadcn(projectPath: string): boolean {
    const possiblePaths = [
      join(projectPath, 'components', 'ui'),
      join(projectPath, 'src', 'components', 'ui'),
    ]
    return possiblePaths.some(p => existsSync(p))
  }

  /** 推断 dev server 端口 */
  private detectPreviewPort(pkg: PackageJsonLike): number | undefined {
    const script = pkg.scripts?.dev || pkg.scripts?.start || ''
    const match = script.match(/port\s+(\d+)/i) || script.match(/-p\s+(\d+)/)
    return match ? Number(match[1]) : undefined
  }
}
