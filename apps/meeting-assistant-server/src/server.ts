/**
 * server.ts - 入口
 *
 * 启动顺序:
 *   1. 加载配置
 *   2. 初始化模块
 *   3. 等用户选项目 → 创建 CodingAgent(绑定 projectPath)
 *   4. 启动 Express + WebSocket
 */
import express from 'express'
import http from 'http'
import type { Duplex } from 'stream'
import type { WebSocket } from 'ws'
import { loadConfig, syncDshExecutorConfig } from './config.js'
import { logger } from './logger.js'

import { LlmHelper } from './judgment/llm-helper.js'
import { JudgmentEngine } from './judgment/judgment-engine.js'

import { FunasrClient } from './asr-relay/funasr-client.js'
import { ChunkDistributor } from './asr-relay/chunk-distributor.js'

import { ProjectScanner } from './project-host/project-scanner.js'
import { CodeMapGenerator } from './project-host/code-map-generator.js'
import { DevServerLauncher } from './project-host/dev-server-launcher.js'

import { ProjectsApi } from './api/projects.js'
import { EventsWs } from './api/events.js'
import { AudioWs } from './api/audio.js'
import { ManualInputWs } from './api/manual-input.js'

async function main() {
  const config = loadConfig()
  logger.info({ port: config.port }, '🚀 Meeting Assistant Server starting')

  // ============ 同步 dsh 执行层模型配置(.env → headless profile patch) ============
  syncDshExecutorConfig(config)

  // 把 API key 注入本进程环境(DshHeadlessRunner spawn 时随 process.env 传给 dsh 子进程,
  // dsh 的 apiKeyEnv 机制会在请求时读取)
  if (config.dsh.executorApiKey && !process.env[config.dsh.executorApiKeyEnv]) {
    process.env[config.dsh.executorApiKeyEnv] = config.dsh.executorApiKey
    logger.info({ env: config.dsh.executorApiKeyEnv }, 'executor API key injected into process env')
  }

  // ============ 初始化模块 ============

  // 1. ASR 链
  const funasr = new FunasrClient(config.funasr.url, { autoReconnect: true })
  const distributor = new ChunkDistributor()

  // 2. CodingAgent 在 ProjectsApi.select 时按 projectPath 创建(此处不预建)
  const llmHelper = new LlmHelper(config.llm.apiKey, config.llm.model, config.llm.baseUrl)

  // 3. 独立判断层
  const engine = new JudgmentEngine(llmHelper)

  // 4. 项目管理
  const scanner = new ProjectScanner()
  const codeMapGen = new CodeMapGenerator()
  const devLauncher = new DevServerLauncher()

  // ============ 等用户选项目后再创建 CodingAgent ============

  // ============ 连接 FunASR ============
  try {
    await funasr.connect()
    logger.info('✅ FunASR connected')
  } catch (err) {
    logger.warn({ err }, '⚠️ FunASR connection failed')
  }

  // ============ 创建 Express ============
  const app = express()
  app.use(express.json({ limit: '10mb' }))

  // CORS(开发阶段)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    next()
  })

  // ============ API 路由 ============
  // CodingAgent 在选择项目时动态创建(因为需要 projectPath)
  // ProjectsApi 用 getter 拿到最新的 engine 和 CodingAgent 配置
  const projectsApi = new ProjectsApi(
    scanner,
    codeMapGen,
    devLauncher,
    config.projectScanDirs,
    () => engine,
  )
  const eventsWs = new EventsWs(engine)
  const audioWs = new AudioWs(funasr, distributor, engine)
  const manualInputWs = new ManualInputWs(distributor, engine)

  // REST
  app.get('/api/projects', projectsApi.list)
  app.post('/api/projects/select', (req, res) => { void projectsApi.select(req, res) })
  app.get('/api/projects/current', projectsApi.current)
  app.post('/api/projects/stop', (req, res) => { void projectsApi.stop(req, res) })
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      llm: { configured: !!config.llm.apiKey, model: config.llm.model },
      funasr: { connected: funasrConnected(funasr) },
    })
  })

  // ============ HTTP + WS 服务 ============
  const server = http.createServer(app)

  // WebSocket routes
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || ''

    if (url.startsWith('/ws/events')) {
      // 事件流
      handleWsUpgrade(server, socket, head, req, (ws) => { eventsWs.handle(ws) })
    } else if (url.startsWith('/ws/audio')) {
      // 音频流
      handleWsUpgrade(server, socket, head, req, (ws) => { audioWs.handle(ws) })
    } else if (url.startsWith('/ws/manual-input')) {
      // 手动输入(隔离于录音)
      handleWsUpgrade(server, socket, head, req, (ws) => { manualInputWs.handle(ws) })
    } else {
      socket.destroy()
    }
  })

  // ============ 启动 ============
  server.listen(config.port, () => {
    logger.info(`✅ Server listening on http://localhost:${config.port}`)
    logger.info('📡 WebSocket:')
    logger.info(`   - ws://localhost:${config.port}/ws/events       (任务事件)`)
    logger.info(`   - ws://localhost:${config.port}/ws/audio        (音频上传 / ASR)`)
    logger.info(`   - ws://localhost:${config.port}/ws/manual-input (手动输入,隔离)`)
    logger.info('🌐 REST API:')
    logger.info('   - GET  /api/projects')
    logger.info('   - POST /api/projects/select')
    logger.info('   - GET  /api/health')
  })

  // ============ 优雅退出 ============
  process.on('SIGINT', () => {
    logger.info('Shutting down...')
    void devLauncher.stop()
    funasr.close()
    server.close()
    process.exit(0)
  })
}

function funasrConnected(_client: FunasrClient): boolean {
  // 简化版:FunasrClient 没有暴露 connected 状态,这里省略
  return true
}

function handleWsUpgrade(
  server: http.Server,
  socket: Duplex,
  head: Buffer,
  req: http.IncomingMessage,
  handler: (ws: WebSocket) => void | Promise<void>,
) {
  // 简化版:用 ws 模块升级
  void import('ws').then(({ WebSocketServer }) => {
    const wss = new WebSocketServer({ noServer: true })
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handler(ws)
    })
  })
}

main().catch((err: unknown) => {
  logger.error({ err: err as Error }, 'Fatal error')
  process.exit(1)
})
