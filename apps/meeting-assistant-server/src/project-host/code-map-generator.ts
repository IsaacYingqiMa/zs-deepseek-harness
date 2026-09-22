/**
 * Code Map 生成器
 *
 * 扫描项目结构,生成 AI 可以查询的代码地图。
 *
 * 输出:
 *   - 组件清单
 *   - API 路由清单
 *   - 页面清单
 *   - 数据模型
 *
 * AI 用这个来判断"该改哪个文件"。
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'fs'
import { join, basename, extname } from 'path'
import { logger } from '../logger.js'
import type { CodeMap, CodeMapNode } from '../types/task.js'

export class CodeMapGenerator {
  /** 生成项目的 Code Map */
  generate(projectPath: string, framework: string): CodeMap {
    const codeMap: CodeMap = {
      root: projectPath,
      framework,
      components: [],
      apiRoutes: [],
      models: [],
      pages: [],
      generatedAt: Date.now(),
    }

    try {
      // 1. 扫描 src/ 目录(Next.js / Vite 标准)
      const srcPath = join(projectPath, 'src')
      const targetPath = existsSync(srcPath) ? srcPath : projectPath

      codeMap.components = this.scanComponents(targetPath, framework)
      codeMap.pages = this.scanPages(targetPath, framework)
      codeMap.apiRoutes = this.scanApiRoutes(targetPath, framework)

      // 2. 数据模型
      const schemaPath = join(projectPath, 'prisma', 'schema.prisma')
      if (existsSync(schemaPath)) {
        codeMap.models = this.parsePrismaSchema(schemaPath)
      }
    } catch (err) {
      logger.error({ err }, 'CodeMap generation failed')
    }

    return codeMap
  }

  private scanComponents(root: string, framework: string): CodeMapNode[] {
    const components: CodeMapNode[] = []
    const searchPaths = [
      join(root, 'components'),
      join(root, 'app'),
    ]

    for (const basePath of searchPaths) {
      if (!existsSync(basePath)) continue
      this.walkDir(basePath, (filePath) => {
        const ext = extname(filePath)
        if (['.tsx', '.jsx', '.vue'].includes(ext)) {
          const name = basename(filePath, ext)
          if (/^[A-Z]/.test(name)) { // 组件名以大写开头
            components.push({
              path: filePath,
              type: 'component',
              framework,
              description: this.extractComponentDescription(filePath),
            })
          }
        }
      }, 5)
    }

    return components
  }

  private scanPages(root: string, framework: string): CodeMapNode[] {
    const pages: CodeMapNode[] = []
    const appPath = join(root, 'app')
    if (!existsSync(appPath)) return pages

    this.walkDir(appPath, (filePath) => {
      const ext = extname(filePath)
      const name = basename(filePath, ext)
      if (['page.tsx', 'page.jsx'].includes(name + ext)) {
        pages.push({
          path: filePath,
          type: 'page',
          framework,
          description: `${name} 页面`,
        })
      }
    }, 5)

    return pages
  }

  private scanApiRoutes(root: string, framework: string): CodeMapNode[] {
    const routes: CodeMapNode[] = []
    const apiPath = join(root, 'app', 'api')
    if (!existsSync(apiPath)) return routes

    this.walkDir(apiPath, (filePath) => {
      const name = basename(filePath, extname(filePath))
      if (name === 'route') {
        routes.push({
          path: filePath,
          type: 'api-route',
          framework,
          description: 'API endpoint',
        })
      }
    }, 5)

    return routes
  }

  private parsePrismaSchema(schemaPath: string): CodeMapNode[] {
    const content = readFileSync(schemaPath, 'utf-8')
    const models: CodeMapNode[] = []
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
    let match
    while ((match = modelRegex.exec(content)) !== null) {
      models.push({
        path: schemaPath,
        type: 'model',
        description: `Prisma model: ${match[1]}`,
      })
    }
    return models
  }

  private extractComponentDescription(filePath: string): string {
    try {
      const content = readFileSync(filePath, 'utf-8')
      // 提取文件顶部注释作为描述
      const commentMatch = content.match(/^[\s\S]*?\/\*\*?\s*\n([\s\S]*?)\*\//)
      if (commentMatch) {
        return commentMatch[1].trim().split('\n')[0]
      }
      // 或者提取第一个 export 的 component 名
      const exportMatch = content.match(/export\s+(?:default\s+)?(?:function|const)\s+(\w+)/)
      if (exportMatch) return `Component: ${exportMatch[1]}`
    } catch {}
    return ''
  }

  private walkDir(dir: string, callback: (filePath: string) => void, depth: number): void {
    if (depth <= 0) return
    try {
      const items = readdirSync(dir)
      for (const item of items) {
        if (['node_modules', '.next', 'dist', 'build', '.git'].includes(item)) continue
        const fullPath = join(dir, item)
        try {
          const stat = statSync(fullPath)
          if (stat.isFile()) {
            callback(fullPath)
          } else if (stat.isDirectory()) {
            this.walkDir(fullPath, callback, depth - 1)
          }
        } catch {}
      }
    } catch {}
  }

  /** 查询接口(给 AI 用) */
  query(codeMap: CodeMap, type: CodeMapNode['type'], keyword?: string): CodeMapNode[] {
    let results: CodeMapNode[]
    switch (type) {
      case 'component': results = codeMap.components; break
      case 'api-route': results = codeMap.apiRoutes; break
      case 'model': results = codeMap.models; break
      case 'page': results = codeMap.pages; break
      default: results = []
    }
    if (keyword) {
      const kw = keyword.toLowerCase()
      results = results.filter(n => n.path.toLowerCase().includes(kw))
    }
    return results
  }
}
