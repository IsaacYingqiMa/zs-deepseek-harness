/**
 * LLM 辅助理解
 */
import { logger } from '../logger.js'
import type { AsrChunk } from '../types/task.js'

export interface LlmIntentOutput {
  intent: string
  rawText: string
  interpreted: string
  target: string | null
  confidence: number
  relationTo: {
    taskId: string | null
    type: 'supersedes' | 'extends' | 'conflicts' | 'rejects' | null
  } | null
  reasoning: string
}

export interface LlmUnderstandResult {
  intents: LlmIntentOutput[]
}

export interface RecentTaskSummary {
  id: string
  interpreted: string
  intent: string
  status: string
  target?: string | null
}

const DEFAULT_BASE_URL = 'https://api.minimaxi.com/anthropic'
const DEFAULT_MODEL = 'MiniMax-M3'

export class LlmHelper {
  private apiKey: string
  private model: string
  private baseUrl: string

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.model = model || DEFAULT_MODEL
    this.baseUrl = baseUrl || DEFAULT_BASE_URL
  }

  getConfig(): { apiKey: string; baseUrl: string; model: string } {
    return { apiKey: this.apiKey, baseUrl: this.baseUrl, model: this.model }
  }

  /**
   * 智能意图提取(单 chunk + 历史 task)
   */
  async understand(chunk: AsrChunk, recentTasks: RecentTaskSummary[] = []): Promise<LlmUnderstandResult | null> {
    if (!this.apiKey) {
      logger.warn('LLM API key not set, skipping')
      return null
    }

    const recentTasksText = recentTasks.length > 0
      ? '\n\n【全部已有 task 列表(去重判断的依据,必须逐条对照!)】\n' +
        recentTasks.map(t =>
          `- ${t.id.slice(0, 6)}: [${t.intent}] target="${t.target ?? '?'}" — ${t.interpreted} [${t.status}]`,
        ).join('\n')
      : ''

    const prompt = [
      '你是会议需求解析助手。从一段会议发言中提取所有产品需求意图,并判断它们与已有 task 的关系。',
      '',
      '【当前发言】',
      `"${chunk.text}"`,
      recentTasksText,
      '',
      '【⚠️ 最高优先级:去重(逐条对照上面的 task 列表!)⚠️】',
      '如果当前发言描述的修改对象(target)与已有 task 相同或高度相似:',
      '  → 不要输出新的需求 intent!',
      '  → 输出 intent=approval 且 relationTo 指向那个已有 task(type=approval)。',
      '只有当对象【完全不同】时才输出新的 add/modify/delete/fix intent。',
      '例:已有 task target="header颜色",发言"头那个条再改蓝" → 同对象 → approval,不建新。',
      '',
      '【规则 1:区分意图和确认】',
      '- 【意图类】提出新需求 / 修改 / 删除 / 补充(有明确新对象)→ 创建 task',
      '- 【确认类】赞同("好的"、"可以"、"改吧"、"没问题"、"到时候去改")、重复同一诉求 → intent=approval,不创建新 task',
      '',
      '【规则 2:每个意图独立】一句话里的多个【不同对象】的动作必须拆成多个 intent。',
      '',
      '【规则 3:对象必须明确】target 必须指出改哪个字段/文件/组件。拿不到就 confidence<0.6 不输出。',
      '',
      '【规则 4:关系判断】',
      '- "这个/那个/它/刚才说的" → 找上文对应 task',
      '- "改成单选" → relationTo.extends(改同一个对象,同时 target 与已有重复时优先 approval)',
      '- "不要了/取消/去掉" → relationTo.rejects',
      '- "换成新的/重做" → relationTo.supersedes',
      '- "好的/可以/同意" → relationTo.type=approval',
      '',
      '【规则 5:置信度】confidence < 0.6 的 intent 不放进数组。',
      '',
      '【输出格式 - 必须是严格合法的 JSON(所有 key 和 value 都带双引号)】',
      '只输出 JSON,不要 markdown 代码块,不要任何解释文字。',
      '',
      '【示例 1:重复诉求(去重!)】',
      '已有 task:abc123 [modify-feature] target="header颜色" — 将header改为蓝色',
      '输入:"那个头再改成蓝色的"',
      '输出:',
      '{"intents":[{"intent":"approval","rawText":"那个头再改成蓝色的","interpreted":"重复诉求:将header改为蓝色","target":"header颜色","confidence":0.9,"relationTo":{"taskId":"abc123","type":"approval"},"reasoning":"对象与已有task abc123相同,是重复提及"}]}',
      '',
      '【示例 2:新对象】',
      '已有 task:abc123 [modify-feature] target="header颜色"',
      '输入:"优先级高的标签改成黄色"',
      '输出:',
      '{"intents":[{"intent":"modify-feature","rawText":"优先级高的标签改成黄色","interpreted":"将优先级高的显示标签颜色改为黄色","target":"优先级高标签","confidence":0.9,"relationTo":null,"reasoning":"与已有task对象不同,是新需求"}]}',
      '',
      '【示例 3:确认】',
      '已有 task:abc123 [modify-feature] target="header颜色"',
      '输入:"好的,改吧"',
      '输出:',
      '{"intents":[{"intent":"approval","rawText":"好的,改吧","interpreted":"同意执行","target":null,"confidence":0.95,"relationTo":{"taskId":"abc123","type":"approval"},"reasoning":"纯确认话"}]}',
      '',
      '【示例 4:无意图】',
      '输入:"嗯呃那个"',
      '输出:',
      '{"intents":[]}',
    ].join('\n')

    try {
      const text = await this.callClaude(prompt, 4096)
      if (!text) return { intents: [] }

      // 提取 JSON(容忍 ```json 包裹和前后杂文)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        logger.warn({ text: text.slice(0, 500) }, 'LLM response did not contain JSON')
        return { intents: [] }
      }

      let parsed: LlmUnderstandResult
      try {
        parsed = JSON.parse(jsonMatch[0]) as LlmUnderstandResult
      } catch {
        // 二次兜底:去尾逗号再试(LLM 常见毛病)
        try {
          parsed = JSON.parse(jsonMatch[0].replace(/,\s*([}\]])/g, '$1')) as LlmUnderstandResult
        } catch (err) {
          logger.warn({ raw: jsonMatch[0].slice(0, 400), err: String(err) }, 'LLM JSON unparseable even after cleanup')
          return { intents: [] }
        }
      }
      parsed.intents = (parsed.intents || []).filter(i => (i.confidence || 0) >= 0.6)

      return parsed
    } catch (err) {
      logger.error({ err }, 'LLM understand failed')
      return null
    }
  }

  private async callClaude(prompt: string, maxTokens: number): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        logger.error({ status: response.status, errText: errText.slice(0, 500) }, 'MiniMax API error')
        return null
      }

      const data = await response.json() as { content: Array<{ type: string; text?: string }> }
      return data.content.filter(b => b.type === 'text').map(b => b.text || '').join('')
    } catch (err) {
      logger.error({ err }, 'MiniMax API call failed')
      return null
    }
  }
}
