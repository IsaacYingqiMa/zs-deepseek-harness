/**
 * Hooks(基于 ws-manager 单例)
 */
import { useEffect, useRef, useState } from 'react'
import { useMeetingStore } from './store'
import { eventsWs, manualInputWs } from './ws-manager'

export function useEventStream() {
  const setWsConnected = useMeetingStore(s => s.setWsConnected)
  const addAsrChunk = useMeetingStore(s => s.addAsrChunk)
  const addTask = useMeetingStore(s => s.addTask)
  const updateTask = useMeetingStore(s => s.updateTask)
  const setQueueState = useMeetingStore(s => s.setQueueState)
  const addReasoning = useMeetingStore(s => s.addReasoning)
  const addCodingStep = useMeetingStore(s => s.addCodingStep)
  const setFilesChanged = useMeetingStore(s => s.setFilesChanged)
  const addDecisionCard = useMeetingStore(s => s.addDecisionCard)
  const addTaskToChunk = useMeetingStore(s => s.addTaskToChunk)

  useEffect(() => {
    const unsubscribeMessage = eventsWs.on((event) => {
      switch (event.type) {
        case 'asr/chunk': addAsrChunk(event.data); break
        case 'task/created':
          addTask(event.data)
          addReasoning({ at: Date.now(), type: 'task-created', text: `✓ 识别到需求:${event.data.interpreted}` })
          break
        case 'task/analyzing':
          addReasoning({ at: Date.now(), type: 'analyzing', text: `🧠 评估可行性 [${event.data.id.slice(0, 6)}]:${event.data.reasoning}` })
          break
        case 'task/confirmed':
          addReasoning({ at: Date.now(), type: 'confirmed', text: `🎯 决策:准备执行 [${event.data.id.slice(0, 6)}] - ${event.data.reason}` })
          break
        case 'task/executing':
          updateTask(event.data.id, { status: 'executing' })
          addReasoning({ at: Date.now(), type: 'executing', text: `⏳ 开始执行 [${event.data.id.slice(0, 6)}]` })
          break
        case 'task/completed':
          updateTask(event.data.id, { status: 'completed', modifiedFiles: event.data.files })
          addReasoning({ at: Date.now(), type: 'completed', text: `✅ 完成 [${event.data.id.slice(0, 6)}]:${event.data.files.length} 个文件 (${event.data.duration}ms)` })
          break
        case 'task/failed':
          updateTask(event.data.id, { status: 'failed', rejectionReason: event.data.error })
          addReasoning({ at: Date.now(), type: 'failed', text: `❌ 失败 [${event.data.id.slice(0, 6)}]:${event.data.error}` })
          break
        case 'task/rejected':
          updateTask(event.data.id, { status: 'rejected', rejectionReason: event.data.reason })
          addReasoning({ at: Date.now(), type: 'rejected', text: `🚫 拒绝 [${event.data.id.slice(0, 6)}]:${event.data.reason}` })
          break
        case 'judgment/signal':
          addReasoning({ at: Date.now(), type: 'signal', text: `[信号] ${event.data.type} (置信度 ${(event.data.confidence * 100).toFixed(0)}%):${event.data.text}` })
          break
        case 'judgment/feasibility':
          addReasoning({ at: Date.now(), type: 'feasibility', text: `[评估] 技术=${event.data.technical}, 风险=${event.data.riskLevel}, 白名单=${event.data.inWhitelist}:${event.data.reasoning}` })
          break
        case 'judgment/completion':
          addReasoning({ at: Date.now(), type: 'completion', text: `[补全] ${event.data.completions.map((c: { field: string }) => c.field).join(', ')}` })
          break

        // ===== CodingAgent 实时步骤 =====
        case 'coding/thinking':
          addCodingStep(event.data.taskId, {
            at: Date.now(),
            type: 'thinking',
            text: event.data.text,
          })
          addReasoning({ at: Date.now(), type: 'coding-thinking', text: `🤖 AI: ${event.data.text.slice(0, 80)}...` })
          break
        case 'coding/tool-call':
          addCodingStep(event.data.taskId, {
            at: Date.now(),
            type: 'tool-call',
            toolName: event.data.name,
            toolArgs: event.data.args,
            callId: event.data.callId,
          })
          addReasoning({
            at: Date.now(),
            type: 'coding-tool',
            text: `🔧 调用工具:${event.data.name}(${JSON.stringify(event.data.args).slice(0, 60)})`,
          })
          break
        case 'coding/tool-result':
          addCodingStep(event.data.taskId, {
            at: Date.now(),
            type: 'tool-result',
            callId: event.data.callId,
            result: event.data.result,
            isError: event.data.isError,
          })
          break

        // ===== 文件变更 → 触发 iframe 自动刷新 =====
        case 'coding/files-changed':
          setFilesChanged(event.data.files)
          addReasoning({
            at: Date.now(),
            type: 'files-changed',
            text: `📁 文件已修改:${event.data.files.join(', ')} → 预览即将自动刷新`,
          })
          break

        // ===== LLM 决策流(展示 AI 怎么判断的) =====
        case 'judgment/reasoning':
          addDecisionCard({
            at: Date.now(),
            ...event.data,
          })
          // 同时给 AI 思考流一条简短消息
          if (event.data.stage === 'decision') {
            const action = event.data.action
            if (action === 'created') {
              addReasoning({
                at: Date.now(),
                type: 'decision',
                text: `✓ 创建任务 #${event.data.taskId?.slice(0, 6)} [${event.data.intent}] target="${event.data.target}" conf:${((event.data.confidence || 0) * 100).toFixed(0)}% — ${event.data.reasoning}`,
              })
              // 记录到 tasksByChunk(用于按轮分组)
              if (event.data.chunkId && event.data.taskId) {
                addTaskToChunk(event.data.chunkId, event.data.taskId)
              }
            } else if (action === 'rejected-existing') {
              addReasoning({
                at: Date.now(),
                type: 'decision',
                text: `🚫 驳回 #${event.data.taskId?.slice(0, 6)} — ${event.data.reasoning}`,
              })
            }
          } else if (event.data.stage === 'unclear') {
            addReasoning({
              at: Date.now(),
              type: 'unclear',
              text: `⚠️ 不清晰:${event.data.text?.substring(0, 40)} — ${event.data.note || '未识别出明确意图'}`,
            })
          }
          break

        // ===== Task 关系变更 =====
        case 'task/relations':
          addReasoning({
            at: Date.now(),
            type: 'relation',
            text: `🔗 ${event.data.taskId.slice(0, 6)} ${relationArrow(event.data.relationType)} ${event.data.relatedTaskId.slice(0, 6)} — ${event.data.description}`,
          })
          break

        case 'queue/state': setQueueState(event.data); break
        case 'initial/state':
          if (event.data.tasks) for (const t of event.data.tasks) addTask(t)
          if (event.data.queue) setQueueState(event.data.queue)
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

/** 关系类型 → emoji */
function relationArrow(type: string): string {
  switch (type) {
    case 'supersedes': return '⤵ 取代'
    case 'extends': return '→ 扩展'
    case 'conflicts': return '⚡ 冲突'
    case 'rejects': return '✗ 驳回'
    default: return '↔'
  }
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
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('WS 连接失败'))
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
      const processor = audioCtx.createScriptProcessor(2048, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return
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

      ws.onerror = () => setError('音频 WS 错误')
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
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
    try { audioCtxRef.current?.close() } catch {}
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
