/**
 * REST API: 项目管理 + CodingAgent 绑定
 */
import type { Request, Response } from 'express'
import { resolve as pathResolve } from 'path'
import { fileURLToPath } from 'url'
import type { ProjectScanner } from '../project-host/project-scanner.js'
import type { CodeMapGenerator } from '../project-host/code-map-generator.js'
import type { DevServerLauncher } from '../project-host/dev-server-launcher.js'
import { CodingAgent } from '../coding-agent/coding-agent.js'
import { DshHeadlessRunner } from '../dsh-headless-runner/dsh-headless-runner.js'
import type { JudgmentEngine } from '../judgment/judgment-engine.js'
import { logger } from '../logger.js'

// dsh bin 绝对路径(显式算,不依赖 cwd / dirname Windows 坑)
const __filename = fileURLToPath(import.meta.url).replace(/\\/g, '/')
// apps/meeting-assistant-server/src/api/projects.ts → monorepo 根(5 层)
const MONOREPO_ROOT = pathResolve(__filename, '..', '..', '..', '..', '..')
const DSH_BIN = pathResolve(MONOREPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')

logger.info({ dshBin: DSH_BIN, exists: true }, 'dsh CLI path configured')

export class ProjectsApi {
  constructor(
    private scanner: ProjectScanner,
    private codeMapGen: CodeMapGenerator,
    private devLauncher: DevServerLauncher,
    private scanDirs: string[],
    private getEngine: () => JudgmentEngine | null,
  ) {}

  list = (req: Request, res: Response): void => {
    try {
      const projects = this.scanner.scan(this.scanDirs)
      res.json({ projects })
    } catch (err) {
      logger.error({ err }, 'Failed to list projects')
      res.status(500).json({ error: String(err) })
    }
  }

  /**
   * 选择项目:
   *   1. 启动 dev server
   *   2. 生成 Code Map
   *   3. 创建 CodingAgent(自研,fallback 用)
   *   4. 创建 DshHeadlessRunner(主路径)
   *   5. 都绑定到 judgment engine
   */
  select = async (req: Request, res: Response): Promise<void> => {
    const { path: projectPath, framework } = req.body as { path: string; framework: string }

    if (!projectPath) {
      res.status(400).json({ error: 'path is required' })
      return
    }

    try {
      // 1. 启动 dev server
      const dev = await this.devLauncher.start(projectPath, framework)

      // 2. 生成 code map
      const codeMap = this.codeMapGen.generate(projectPath, framework)

      // 3. 创建 CodingAgent + DshHeadlessRunner
      const engine = this.getEngine()
      if (engine) {
        const llmConfig = engine.getLlmConfig()

        // 3a. CodingAgent(自研,fallback)
        const codingAgent = new CodingAgent({
          apiKey: llmConfig.apiKey,
          baseUrl: llmConfig.baseUrl,
          model: llmConfig.model,
          projectPath,
        })

        // 3b. DshHeadlessRunner(主路径,用 dsh 完整框架)
        const dshRunner = new DshHeadlessRunner({
          dshBin: DSH_BIN,  // 显式传绝对路径(避免 Windows path.dirname 坑)
          timeoutMs: 300_000,
        })

        // 4. 绑定:engine 内部调度 dshRunner,失败 fallback codingAgent
        engine.bindCodingAgent(codingAgent, dshRunner)

        // 5. 告诉 scheduler 项目根目录(dsh 需要)
        engine.bindProjectPath(projectPath)

        logger.info({ projectPath }, 'CodingAgent + DshHeadlessRunner bound')
      } else {
        logger.warn('Engine not available, agents not bound')
      }

      res.json({
        ok: true,
        project: {
          path: projectPath,
          framework,
          previewUrl: dev.url,
          port: dev.port,
        },
        codeMap,
      })
    } catch (err) {
      logger.error({ err }, 'Failed to select project')
      res.status(500).json({ error: String(err) })
    }
  }

  current = (req: Request, res: Response): void => {
    const dev = this.devLauncher.getCurrent()
    if (!dev) {
      res.json({ current: null })
      return
    }
    res.json({
      current: {
        previewUrl: dev.url,
        port: dev.port,
      },
    })
  }

  stop = async (req: Request, res: Response): Promise<void> => {
    await this.devLauncher.stop()
    res.json({ ok: true })
  }
}
