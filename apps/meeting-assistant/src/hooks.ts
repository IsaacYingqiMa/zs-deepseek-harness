/**
 * Hooks(基于 ws-manager 单例)
 *
 * 改造说明:
 *   - 废弃 addReasoning / addDecisionCard,改用 upsertModule / addModuleTask / syncModuleTask
 *   - judgment/reasoning 事件按 judgeId 归并到 JudgeModule
 *   - 不再推 unclear / rejected / incomplete 短消息(由模块自展示)
 *   - task/* 事件实时同步 module.tasks[*] 状态
 */
import { useEffect, useRef, useState } from 'react'
import { useMeetingStore } from './store'
import { eventsWs, manualInputWs } from './ws-manager'
import type { ModuleAgentRun } from './types'

/**
 * 记录/更新智能体跑动(module 级别,用于弹窗展示)
 * - 已有同 module+agent 的 working run → 改成目标状态
 * - 没有 → 新增
 *
 * 用于 3 个早期智能体(intent / feasibility / rule-fallback)的跑动追踪,
 * 因为这 3 个 agent 没有具体 taskId(意图提取在 task 创建之前发生),
 * 所以用 moduleId 或 '__global__' 作虚拟 key。
 */
function recordAgentRun(
  agentType: 'intent' | 'feasibility' | 'rule-fallback',
  moduleId: string,
  taskId: string,
  status: 'working' | 'success' | 'failed',
  summary?: string,
  durationMs?: number,
  runId?: string,
) {
  const store = useMeetingStore.getState()
  const existing = store.moduleAgentHistory.get(moduleId)
    ?.find(r => r.agent === agentType && r.status === 'working')
  if (existing) {
    const finishedAt = Date.now()
    const finalDuration = durationMs ?? finishedAt - existing.startedAt
    const newHistory = new Map(store.moduleAgentHistory)
    const runs = (newHistory.get(moduleId) ?? []).map(r =>
      r.id === existing.id
        ? {
          ...r,
          status,
          summary: summary ?? r.summary,
          finishedAt,
          durationMs: finalDuration,
        }
        : r,
    )
    newHistory.set(moduleId, runs)
    useMeetingStore.setState({ moduleAgentHistory: newHistory })
  } else {
    const run: ModuleAgentRun = {
      id: runId ?? `${agentType}-${moduleId}-${Date.now()}`,
      moduleId,
      agent: agentType,
      taskId,
      status,
      startedAt: Date.now() - (durationMs ?? 0),
      finishedAt: status === 'working' ? undefined : Date.now(),
      durationMs: durationMs ?? 0,
      summary,
      files: undefined,
    }
    store.recordModuleAgentRun(run)
  }
}

export function useEventStream() {
  const setWsConnected = useMeetingStore(s => s.setWsConnected)
  const addAsrChunk = useMeetingStore(s => s.addAsrChunk)
  const addTask = useMeetingStore(s => s.addTask)
  const updateTask = useMeetingStore(s => s.updateTask)
  const setQueueState = useMeetingStore(s => s.setQueueState)
  const addCodingStep = useMeetingStore(s => s.addCodingStep)
  const setFilesChanged = useMeetingStore(s => s.setFilesChanged)
  const upsertModule = useMeetingStore(s => s.upsertModule)
  const addModuleTask = useMeetingStore(s => s.addModuleTask)
  const syncModuleTask = useMeetingStore(s => s.syncModuleTask)
  const addTaskToChunk = useMeetingStore(s => s.addTaskToChunk)
  const setStats = useMeetingStore(s => s.setStats)
  const setAgentStatus = useMeetingStore(s => s.setAgentStatus)
  const setTaskPhase = useMeetingStore(s => s.setTaskPhase)
  const addDecisionLog = useMeetingStore(s => s.addDecisionLog)
  const applyVersionBump = useMeetingStore(s => s.applyVersionBump)

  useEffect(() => {
    const unsubscribeMessage = eventsWs.on((rawEvent) => {
      // ws-manager 的 EventListener 是 (data: unknown) => void,这里断言成结构化事件
      // data 用 any 是因为事件类型太多(每种事件的 data 形状不同),不强求精确
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = rawEvent as { type: string; data?: any }
      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      /* eslint-disable @typescript-eslint/no-unsafe-argument */
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      switch (event.type) {
        case 'asr/chunk': addAsrChunk(event.data); break

        // ===== Task 状态事件(同时同步 module.tasks) =====
        case 'task/created':
          addTask(event.data)
          break
        case 'task/analyzing':
          syncModuleTask(event.data.id, { currentStatus: 'analyzing' })
          // ★ 阶段:需求讨论(brain)
          setTaskPhase(event.data.id, 'brain')
          break
        case 'task/confirmed':
          syncModuleTask(event.data.id, { currentStatus: 'confirmed' })
          break
        case 'task/executing':
          updateTask(event.data.id, { status: 'executing' })
          syncModuleTask(event.data.id, { currentStatus: 'executing' })
          break
        case 'task/completed':
          updateTask(event.data.id, {
            status: 'completed',
            modifiedFiles: event.data.files,
            completedAt: Date.now(),
          })
          syncModuleTask(event.data.id, {
            currentStatus: 'completed',
            modifiedFiles: event.data.files,
            completedAt: Date.now(),
          })
          // ★ 阶段切到 done(验收完成)
          setTaskPhase(event.data.id, 'done')
          // ★ 把 3 个执行智能体都标 success(显示绿色完成态,不再卡在 working)
          setAgentStatus('spec-agent', { agent: 'spec-agent', state: 'success', message: '任务完成', updatedAt: Date.now() })
          setAgentStatus('dev-agent',  { agent: 'dev-agent',  state: 'success', message: '任务完成', updatedAt: Date.now() })
          setAgentStatus('test-agent', { agent: 'test-agent', state: 'success', message: '任务完成', updatedAt: Date.now() })
          break
        case 'task/failed':
          updateTask(event.data.id, { status: 'failed', rejectionReason: event.data.error })
          syncModuleTask(event.data.id, {
            currentStatus: 'failed',
            rejectionReason: event.data.error,
          })
          // 任务失败,phase 切到 failed
          setTaskPhase(event.data.id, 'failed')
          break
        case 'task/rejected':
          updateTask(event.data.id, { status: 'rejected', rejectionReason: event.data.reason })
          syncModuleTask(event.data.id, {
            currentStatus: 'rejected',
            rejectionReason: event.data.reason,
          })
          break
        case 'task/deferred':
          updateTask(event.data.id, { status: 'deferred', rejectionReason: event.data.reason })
          syncModuleTask(event.data.id, { currentStatus: 'deferred' })
          break

        // ===== 执行层 3 阶段事件(Spec / Dev / Test 智能体驱动) =====
        case 'execution/phase': {
          // event.data: { taskId, phase, status, files?, summary?, durationMs? }
          const { taskId, phase, status, files, summary, durationMs } = event.data as {
            taskId: string
            phase: 'spec' | 'apply' | 'finver'
            status: 'running' | 'done' | 'failed'
            files?: string[]
            summary?: string
            durationMs?: number
          }
          // 路由到对应 agent 类型(spec-agent / dev-agent / test-agent)
          const agentType = phase === 'spec' ? 'spec-agent'
            : phase === 'apply' ? 'dev-agent'
              : 'test-agent'

          // 1. 更新 agent status(顶部卡片显示动效)
          const agentState = status === 'running' ? 'working'
            : status === 'done' ? 'success'
              : 'failed'
          setAgentStatus(agentType, {
            agent: agentType,
            state: agentState,
            message: summary || `${phase} ${status}`,
            durationMs,
            updatedAt: Date.now(),
          })

          // 2. 记录模块智能体跑动
          const taskState = useMeetingStore.getState()
          const task = taskState.tasks.get(taskId)
          const moduleId = task?.feasibility.codeMapRefs[0]
            || task?.llm?.target
            || taskId.slice(0, 6)
          taskState.recordModuleAgentRun({
            id: `${taskId}-${phase}-${Date.now()}`,
            moduleId,
            agent: agentType,
            taskId,
            status: agentState,
            startedAt: Date.now() - (durationMs ?? 0),
            finishedAt: status === 'running' ? undefined : Date.now(),
            durationMs,
            summary,
            files,
          })

          // 3. 联动 phase(task 进度条 4 阶段:brain/spec/apply/done)
          //    这里把后端细分 phase(spec/apply/finver + running/done/failed)映射回基础 phase
          if (phase === 'spec') {
            // spec 阶段:running → spec(进度条显示 spec),done → spec(没变),failed → failed
            setTaskPhase(taskId, status === 'failed' ? 'failed' : 'spec')
          } else if (phase === 'apply') {
            // apply 阶段:running/done 都显示 apply(没完成 finver 不算 done),failed → failed
            setTaskPhase(taskId, status === 'failed' ? 'failed' : 'apply')
          } else {
            // finver 阶段(最终验收):running/done 都显示 apply,完成才到 done
            setTaskPhase(taskId, status === 'failed' ? 'failed'
              : status === 'done' ? 'done' : 'apply')
          }
          break
        }

        case 'judgment/signal': break  // 暂时忽略,模块化后不需要单独展示
        case 'judgment/feasibility':
          // 同步可行性到 module(给 rejected task 展示原因用)
          syncModuleTask(event.data.taskId, {
            feasibility: {
              technical: event.data.technical,
              workload: event.data.workload,
              riskLevel: event.data.riskLevel,
              inWhitelist: event.data.inWhitelist,
              codeMapRefs: event.data.codeMapRefs,
              reasoning: event.data.reasoning,
            },
          })
          // ★ 阶段切到 spec(可行性评估 = 规格生成/变更)
          setTaskPhase(event.data.taskId, 'spec')
          // ★ 记录 feasibility 智能体跑动(评估完成 = success)
          {
            const task = useMeetingStore.getState().tasks.get(event.data.taskId)
            const moduleId = task?.feasibility.codeMapRefs[0]
              ?? task?.llm?.target
              ?? String(event.data.taskId).slice(0, 6)
            const isFeasible = event.data.inWhitelist
              && event.data.riskLevel !== 'high'
              && event.data.workload !== 'large'
              && event.data.technical === 'feasible'
            recordAgentRun(
              'feasibility',
              moduleId,
              event.data.taskId,
              isFeasible ? 'success' : 'failed',
              isFeasible ? `可行:${event.data.reasoning}` : `不可行:${event.data.reasoning}`,
              undefined,
            )
          }
          break
        case 'judgment/completion':
          // 自主补全细节(扩展到 module)
          break

        // ===== CodingAgent 实时步骤 + phase 推断(单向推进 apply) =====
        case 'coding/thinking':
          addCodingStep(event.data.taskId, {
            at: Date.now(),
            type: 'thinking',
            text: event.data.text,
          })
          // 不再切回 thinking/brain/spec —— 已经进入 apply,保持
          break
        case 'coding/tool-call': {
          addCodingStep(event.data.taskId, {
            at: Date.now(),
            type: 'tool-call',
            toolName: event.data.name,
            toolArgs: event.data.args,
            callId: event.data.callId,
          })
          // ★ 阶段切到 apply(开发 + 测试,统一阶段)
          setTaskPhase(event.data.taskId, 'apply')
          break
        }
        case 'coding/tool-result':
          addCodingStep(event.data.taskId, {
            at: Date.now(),
            type: 'tool-result',
            callId: event.data.callId,
            result: event.data.result,
            isError: event.data.isError,
          })
          break

        case 'coding/files-changed':
          setFilesChanged(event.data.files)
          break

        // ===== LLM 决策流:按 stage 归并到 JudgeModule =====
        case 'judgment/reasoning': {
          const data = event.data as Record<string, unknown> & {
            stage?: string
            chunkIds?: string[]
            chunks?: Array<{ chunkId: string; speaker: string; text: string; timestamp: number }>
            windowSpanMs?: number
            action?: string
            taskId?: string
            intent?: string
            target?: string | null
            confidence?: number
            reasoning?: string
            sourceChunkId?: string
            chunkId?: string
          }

          // ★ input 阶段:创建/更新 module,写入 ASR 来源
          if (data.stage === 'input') {
            const chunks = data.chunks ?? []
            if (chunks.length === 0) break
            const firstChunk = chunks[0]
            const lastChunk = chunks[chunks.length - 1]
            const judgeId = `judge-${firstChunk.chunkId}`
            upsertModule({
              judgeId,
              startedAt: firstChunk.timestamp,
              windowSpanMs: data.windowSpanMs ?? (lastChunk.timestamp - firstChunk.timestamp),
              chunks: chunks.map(c => ({
                chunkId: c.chunkId,
                speaker: c.speaker as 'boss' | 'pm' | 'dev' | 'unknown',
                text: c.text,
                timestamp: c.timestamp,
              })),
            })

            // ★ intent 智能体开始记录(working)
            const taskState = useMeetingStore.getState()
            taskState.recordModuleAgentRun({
              id: `intent-${firstChunk.chunkId}-${Date.now()}`,
              moduleId: judgeId,
              agent: 'intent',
              taskId: firstChunk.chunkId,  // 用首个 chunk id 作虚拟 taskId
              status: 'working',
              startedAt: Date.now(),
            })
            break
          }

          // ★ llm 阶段:intent 提取结果(给前端展示用)
          // 这里不用处理(直接走 decision 处理)

          // ★ decision 阶段:把每个 intent 的去向作为 ModuleTask 写入
          if (data.stage === 'decision') {
            const chunks = (data.chunks ?? []) as Array<{ chunkId: string; timestamp: number }>
            if (chunks.length === 0 && !data.sourceChunkId) break
            const firstChunk = chunks[0]
            // 用 sourceChunkId 或第一 chunk 找 judgeId
            const anchorChunkId = data.sourceChunkId ?? firstChunk.chunkId
            if (!anchorChunkId) break
            const judgeId = `judge-${anchorChunkId}`

            // 写入 ModuleTask
            const task = event.data as {
              taskId?: string
              intent?: string
              target?: string | null
              confidence?: number
              reasoning?: string
              sourceChunkId?: string | null
              intentCount?: number
              intentList?: Array<{ intent: string; reasoning?: string; confidence?: number; target?: string | null }>
            }
            if (task.taskId && task.intent) {
              addModuleTask(judgeId, {
                taskId: task.taskId,
                intent: task.intent as import('./types').TaskIntent,
                target: task.target ?? null,
                confidence: task.confidence ?? 0,
                reasoning: task.reasoning ?? '',
                sourceChunkId: task.sourceChunkId ?? null,
                currentStatus: 'detected',  // 之后会被 task/* 事件更新
              })

              // 记录到 tasksByChunk
              if (data.chunkId && task.taskId) {
                addTaskToChunk(data.chunkId, task.taskId)
              }
            }

            // ★ intent 智能体完成 → 改 working → success
            recordAgentRun(
              'intent',
              judgeId,
              firstChunk.chunkId,
              'success',
              data.intentCount
                ? `提取 ${data.intentCount as unknown as string} 个意图`
                : (task.intentList?.length ? `提取 ${task.intentList.length} 个意图` : '提取完成'),
              undefined,
            )
            break
          }

          // ★ rejected / unclear / incomplete 阶段:丢弃(不展示)
          // 但 intent 智能体仍然算完成(改 running → success)
          if (data.stage === 'rejected' || data.stage === 'unclear' || data.stage === 'incomplete') {
            const chunks = (data.chunks ?? []) as Array<{ chunkId: string; timestamp: number }>
            if (chunks.length > 0) {
              const firstChunk = chunks[0]
              const judgeId = `judge-${firstChunk.chunkId}`
              recordAgentRun(
                'intent',
                judgeId,
                firstChunk.chunkId,
                'success',
                data.stage === 'rejected' ? '无意图' : '处理完成',
                undefined,
              )
            }
          }
          break
        }

        // ===== Task 关系变更 =====
        case 'task/relations': break  // 暂不展示

        case 'queue/state': setQueueState(event.data); break
        case 'initial/state':
          if (event.data.tasks) for (const t of event.data.tasks) addTask(t)
          if (event.data.queue) setQueueState(event.data.queue)
          if (event.data.stats) setStats(event.data.stats)
          break

        // ★ 决策统计(StatsBar 用)
        case 'stats/updated':
          setStats(event.data)
          break

        // ★ 决策日志(DecisionLog 面板用)
        case 'decision/log':
          addDecisionLog(event.data)
          break

        // ★ 智能体工作状态(AgentStatusRow 卡片)
        case 'agent/status': {
          const d = event.data
          setAgentStatus(d.agent, {
            agent: d.agent,
            state: d.state,
            message: d.message,
            durationMs: d.durationMs,
            updatedAt: d.timestamp ?? Date.now(),
          })
          // ★ 同步记录到 moduleAgentHistory(让弹窗可查所有 6 个智能体)
          // agent/status 携带 moduleId 暂未提供,所以从 mark 推断
          const moduleId = (d as unknown as { moduleId?: string }).moduleId ?? '__global__'
          if (['intent', 'feasibility', 'rule-fallback'].includes(d.agent)) {
            recordAgentRun(
              d.agent as 'intent' | 'feasibility' | 'rule-fallback',
              moduleId,
              moduleId,  // 前 3 个 agent 没有 taskId,用 moduleId 作虚拟
              d.state === 'working' ? 'working' : d.state === 'success' ? 'success' : 'failed',
              d.message,
              d.durationMs,
            )
          }
          break
        }

        // ★ 版本号 bump(每次代码改动触发)
        case 'version/bump':
          applyVersionBump({
            version: event.data.version,
            files: event.data.files ?? [],
            taskId: event.data.taskId,
            timestamp: event.data.timestamp ?? Date.now(),
          })
          break
      }
    })

    const unsubscribeState = eventsWs.onState((state) => {
      setWsConnected(state === 'open')
    })

    eventsWs.start()

    return () => {
      unsubscribeMessage()
      unsubscribeState()
    }
  }, [])
}

/**
 * 录音 hook —— 用 Web Audio API 直接采集 PCM Int16 16KHz
 *
 * 按 FunASR 官方协议:
 *   1. 第一帧:JSON 配置(mode / chunk_size / chunk_interval / audio_fs / ...)
 *   2. 后续帧:PCM Int16 二进制
 *   3. 停止帧:JSON {is_speaking: false}
 */
export function useRecorder() {
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // eslint-disable-next-line no-deprecated
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    try {
      // 1. WebSocket 连接
      const ws = new WebSocket(`ws://${location.host}/ws/audio`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => { resolve() }
        ws.onerror = () => { reject(new Error('WS 连接失败')) }
      })

      // 2. 第一帧:FunASR 配置 JSON
      ws.send(JSON.stringify({
        mode: '2pass',
        chunk_size: [5, 10, 5],
        chunk_interval: 10,
        audio_fs: 16000,
        wav_name: 'meeting',
        is_speaking: true,
        hotwords: '',
        itn: true,
      }))

      // 3. AudioContext(强制 16KHz mono)
      const audioCtx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = audioCtx
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      })
      streamRef.current = stream

      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source

      // ScriptProcessor 取 PCM(2048 样本/次 ≈ 128ms @16KHz)
      // eslint-disable-next-line no-deprecated
      const processor = audioCtx.createScriptProcessor(2048, 1, 1)
      processorRef.current = processor

      // eslint-disable-next-line no-deprecated
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return
        // eslint-disable-next-line no-deprecated
        const float32 = e.inputBuffer.getChannelData(0)

        // Float32 → Int16 PCM(标准 PCM 编码)
        const int16 = new Int16Array(float32.length)
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]))
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        // 直接发 ArrayBuffer(二进制帧)
        ws.send(int16.buffer)
      }

      source.connect(processor)
      // ScriptProcessor 必须连到 destination 才工作(浏览器要求)
      // 用 gain=0 避免回声
      const silentGain = audioCtx.createGain()
      silentGain.gain.value = 0
      processor.connect(silentGain)
      silentGain.connect(audioCtx.destination)

      ws.onerror = () => { setError('音频 WS 错误') }
      ws.onclose = () => {
        console.warn('Audio WS closed')
      }

      setIsRecording(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '麦克风权限被拒绝')
      // 清理
      cleanup()
    }
  }

  const stop = () => {
    // 发结束帧
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ is_speaking: false }))
      } catch {}
    }
    cleanup()
    setIsRecording(false)
  }

  const cleanup = () => {
    try { processorRef.current?.disconnect() } catch {}
    try { sourceRef.current?.disconnect() } catch {}
    try { streamRef.current?.getTracks().forEach((t) => { t.stop() }) } catch {}
    try { void audioCtxRef.current?.close() } catch {}
    try { wsRef.current?.close() } catch {}
    processorRef.current = null
    sourceRef.current = null
    streamRef.current = null
    audioCtxRef.current = null
    wsRef.current = null
  }

  return { isRecording, start, stop, error }
}

/**
 * 手动输入 hook
 */
export type ManualSpeaker = 'boss' | 'pm' | 'dev' | 'unknown'

export function useManualInput() {
  const [connected, setConnected] = useState(manualInputWs.isConnected())

  useEffect(() => {
    // 订阅状态
    const unsubscribeState = manualInputWs.onState((state) => {
      setConnected(state === 'open')
    })
    // 启动(如果还没)
    manualInputWs.start()

    return () => {
      unsubscribeState()
      // 不关 WS
    }
  }, [])

  const send = (text: string, speaker: ManualSpeaker = 'unknown'): boolean => {
    if (!manualInputWs.isConnected()) {
      console.warn('manual-input WS not connected')
      return false
    }
    return manualInputWs.send({ type: 'input', text, speaker })
  }

  return { connected, send }
}
