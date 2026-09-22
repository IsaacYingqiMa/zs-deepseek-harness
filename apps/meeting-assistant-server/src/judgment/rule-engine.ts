/**
 * 规则引擎 - 第一层判断(快速、确定)
 */
import type { RuleResult, Signal, TaskIntent } from '../types/task.js'

/** 强需求信号 */
const REQUIREMENT_PATTERNS: Array<{ pattern: RegExp; intent: TaskIntent }> = [
  { pattern: /(加|增加|新增|添加|加个|多加|多来|多放|多挂|加了|加个|加几).{0,30}(功能|字段|页面|菜单|筛选|导出|搜索|几个|示例|例子|按钮)?/, intent: 'add-feature' },
  { pattern: /(改|修改|调整|优化|更新|修|改了|调整了|优化了).{0,30}(这个|那个|一下|一|下|好|就)?/, intent: 'modify-feature' },
  { pattern: /(删除|去掉|移除|不要|删了|去除|删掉|删几)/, intent: 'delete-feature' },
  { pattern: /(修|解决|搞定|修复|处理|修好|处理了).{0,30}(BUG|问题|报错|错误|不|没|无效|失败|崩|坏|生效)?/, intent: 'fix-bug' },
  { pattern: /(样式|界面|UI|颜色|布局|间距|大小|风格).{0,20}(改|调|换|优化|变)/, intent: 'style-change' },
  { pattern: /(加|增加|补充).{0,20}(字段|列|数据|表)/, intent: 'data-change' },
]

/** 弱信号:讨论中 */
const DISCUSSION_PATTERNS: RegExp[] = [
  /(怎么样|如何|怎么|要不要|是不是|应该)/,
  /(讨论|商量|想想|考虑一下|回头|下次)/,
]

/** BUG 报告信号(优先级最高) */
const BUG_PATTERNS: RegExp[] = [
  /(坏了|崩了|出错|报错|不对|失败|无效|不生效|没用|没反应)/,
  /(不好用|不能用|不行|打不开|显示不出来|没出现|没显示)/,
  /(有问题|BUG|bug)/,
]

/** 暂存信号(不是 rejection,是 deferred) */
const DEFER_PATTERNS: RegExp[] = [
  /(先这样吧|先不改|先不动|先不要|等等|先放放|等等吧|待会|下次|以后|回头)/,
  /(先不做|先不用|先忽略)/,
]

/** 闲聊信号 */
const CHITCHAT_PATTERNS: RegExp[] = [
  /^(嗯|哦|好的|行|哈哈|呵呵|是的|对|没错)/,
  /^(那|然后|接下来|之后)/,
]

const STOP_WORDS = new Set([
  '的', '了', '是', '我', '你', '他', '它', '我们', '你们', '他们',
  '这', '那', '这个', '那个', '这些', '那些',
  '就', '也', '都', '还', '又', '再', '才', '已',
  '要', '会', '能', '可以', '应该', '可能',
  '啊', '呢', '吧', '吗', '哦', '嗯', '嗯嗯',
  '一下', '一种', '一些',
])

export class RuleEngine {
  /** 主入口:对一段 ASR 文本做规则分类 */
  classify(text: string): RuleResult {
    const signals: Signal[] = []
    const intents: TaskIntent[] = []
    const keywords: string[] = []

    // 1. 检测 BUG(优先级最高)
    for (const pattern of BUG_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        signals.push({ type: 'bug', confidence: 0.85, text: match[0], matchedPattern: pattern.source })
        if (!intents.includes('fix-bug')) intents.push('fix-bug')
      }
    }

    // 2. 检测强需求
    for (const { pattern, intent } of REQUIREMENT_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        signals.push({ type: 'requirement', confidence: 0.9, text: match[0], matchedPattern: pattern.source })
        if (!intents.includes(intent)) intents.push(intent)
        keywords.push(...this.extractKeywords(match[0]))
      }
    }

    // 3. 检测讨论
    let discussionCount = 0
    for (const pattern of DISCUSSION_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        signals.push({ type: 'discussion', confidence: 0.6, text: match[0], matchedPattern: pattern.source })
        discussionCount++
      }
    }

    // 4. 检测闲聊
    for (const pattern of CHITCHAT_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        signals.push({ type: 'chitchat', confidence: 0.7, text: match[0], matchedPattern: pattern.source })
      }
    }

    const intent = this.resolveIntent(intents, discussionCount)
    const allKeywords = this.extractKeywords(text)
    keywords.push(...allKeywords)

    return {
      signals,
      intent,
      keywords: [...new Set(keywords)],
    }
  }

  /** 判断是否"明确是需求" */
  isStrongRequirement(text: string): boolean {
    return REQUIREMENT_PATTERNS.some(({ pattern }) => pattern.test(text)) ||
           BUG_PATTERNS.some(pattern => pattern.test(text))
  }

  /** 判断是否"被驳回"(只有真不算软才 reject) */
  isRejection(text: string): boolean {
    // "先这样吧" 是暂存,不是真 reject
    const hardRejection = [
      /(算了|取消|不要了|撤销|丢掉|不用)/,
    ]
    return hardRejection.some(p => p.test(text))
  }

  /** 判断是否"暂存"(先这样 / 待会再说) */
  isDefer(text: string): boolean {
    return DEFER_PATTERNS.some(p => p.test(text))
  }

  /** 判断是否"老板态度积极" */
  isApproval(text: string): boolean {
    return /(做吧|可以|好|行|就这么办|同意|确认|开始|改吧)/.test(text)
  }

  private resolveIntent(intents: TaskIntent[], discussionCount: number): TaskIntent {
    if (intents.length > 0 && discussionCount === 0) return intents[0]
    if (discussionCount > 0 && intents.length === 0) return 'discussion'
    if (discussionCount > 0 && intents.length > 0) return 'unclear'
    return 'unclear'
  }

  private extractKeywords(text: string): string[] {
    const keywords: string[] = []
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i <= text.length - len; i++) {
        const word = text.substring(i, i + len)
        if (this.isLikelyKeyword(word)) keywords.push(word)
      }
    }
    return keywords
  }

  private isLikelyKeyword(word: string): boolean {
    if (STOP_WORDS.has(word)) return false
    if (/^[\d\W]+$/.test(word)) return false
    return true
  }
}
