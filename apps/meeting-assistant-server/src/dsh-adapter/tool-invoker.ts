/**
 * Tool 调用代理(可选)
 *
 * 手动触发 dsh 的工具(不用通过 prompt)。
 * 当前未启用,保留为未来扩展。
 */
import { logger } from '../logger.js'
import type { DshAdapter } from './session-manager.js'

export class ToolInvoker {
  constructor(private dshAdapter: DshAdapter) {}

  /** 调用 dsh 工具 */
  async invoke(toolName: string, args: unknown): Promise<unknown> {
    const sessionId = this.dshAdapter.getSessionId()
    if (!sessionId) throw new Error('dsh session not initialized')

    logger.info({ toolName, args }, 'Invoking dsh tool')

    const response = await fetch(
      `${process.env.DSH_BASE_URL || 'http://127.0.0.1:3080'}/api/sessions/${sessionId}/tools/invoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName, args }),
      },
    )

    if (!response.ok) {
      throw new Error(`Tool invoke failed: ${response.status}`)
    }

    return response.json()
  }
}
