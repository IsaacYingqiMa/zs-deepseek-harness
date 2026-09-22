/**
 * POC: 测试 dsh headless 是否能跑通
 *
 * 跑:
 *   dsh --profile headless --json "你的任务"
 * 读 stdout(逐行 JSON events)
 */

import { spawn } from 'child_process'
import { logger } from './src/logger.js'

const DSH_BIN = 'D:/InspurCode/zs-deepseek-harness/apps/cli/lib/bin.js'

interface DshEvent {
  type: string
  [key: string]: unknown
}

async function testHeadless(): Promise<void> {
  // 用一个简单任务:列举当前目录文件(让 dsh 用工具改东西验证 tool_call)
  const task = process.argv[2] || '查看当前目录有哪些文件,然后总结给我'

  console.log(`\n${'='.repeat(60)}`)
  console.log('POC: dsh headless')
  console.log(`任务: ${task}`)
  console.log('='.repeat(60))

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [DSH_BIN, '--profile', 'headless', '--json', task], {
      cwd: 'D:/InspurCode/zs-deepseek-harness',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    const events: DshEvent[] = []

    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      // 按行解析
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() || '' // 最后一行可能不完整
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event: DshEvent = JSON.parse(trimmed)
          events.push(event)
          // 打印事件摘要
          const summary = eventSummary(event)
          console.log(`[${event.type}] ${summary}`)
        } catch (err) {
          console.log(`[parse error] ${trimmed.slice(0, 100)}`)
        }
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const s = chunk.toString()
      stderrBuf += s
      // dsh 用 stderr 打印推理
      process.stderr.write(s)
    })

    proc.on('close', (code) => {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`退出码: ${code}`)
      console.log(`事件数: ${events.length}`)
      console.log('事件类型分布:')
      const dist: Record<string, number> = {}
      for (const e of events) {
        dist[e.type] = (dist[e.type] || 0) + 1
      }
      for (const [t, n] of Object.entries(dist)) {
        console.log(`  ${t}: ${n}`)
      }
      console.log('='.repeat(60))

      // 检查关键事件是否存在
      const hasSession = events.some(e => e.type === 'session')
      const hasFinal = events.some(e => e.type === 'final')
      const hasText = events.some(e => e.type === 'text')

      console.log('\n📊 关键检查:')
      console.log(`  ✓ session 事件: ${hasSession ? '✅' : '❌'}`)
      console.log(`  ✓ text 事件: ${hasText ? '✅' : '❌'}`)
      console.log(`  ✓ final 事件: ${hasFinal ? '✅' : '❌'}`)

      if (code === 0 && hasSession && hasFinal) {
        console.log('\n🎉 POC 成功!')
      } else {
        console.log('\n⚠️ POC 部分失败')
        console.log('stderr 末尾:', stderrBuf.slice(-500))
      }

      resolve()
    })

    proc.on('error', (err) => {
      console.error('spawn 错误:', err)
      reject(err)
    })
  })
}

function eventSummary(e: DshEvent): string {
  switch (e.type) {
    case 'session':
      return `sessionId=${(e.session as any)?.sessionId || '?'}`
    case 'status':
      return `${e.status || ''} ${e.message || ''}`
    case 'text':
      const t = (e.text as string) || ''
      return `"${t.slice(0, 60)}${t.length > 60 ? '...' : ''}"`
    case 'thinking':
      const th = (e.text as string) || (e.thinking as string) || ''
      return `"${th.slice(0, 60)}${th.length > 60 ? '...' : ''}"`
    case 'tool_call':
      return `name=${e.name || '?'} args=${JSON.stringify(e.args).slice(0, 50)}`
    case 'tool_result':
      const r = (e.result as string) || ''
      return `"${r.slice(0, 60)}${r.length > 60 ? '...' : ''}"`
    case 'final':
      const f = (e.text as string) || ''
      return `text="${f.slice(0, 80)}..."`
    default:
      return JSON.stringify(e).slice(0, 80)
  }
}

testHeadless().catch((err) => {
  console.error(err)
  process.exit(1)
})
