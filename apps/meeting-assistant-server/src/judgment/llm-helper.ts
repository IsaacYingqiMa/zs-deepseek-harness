/**
 * LLM 辅助理解
 */
import { logger } from '../logger.js'
import type { AsrChunk, CodeMap, Feasibility, Task } from '../types/task.js'

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
  /** 引用了窗口里哪条 chunk(用于前端展示"依据哪个发言") */
  sourceChunkId: string | null
  reasoning: string
  /**
   * 这条 intent 对应的发言是否被截断 / 不完整
   *
   * true 表示:
   *   - 不应该建 task(LLM 也无法判断具体需求)
   *   - engine 把它对应的 chunk 放回 pendingIncomplete,等后续补全
   *   - 前端展示"等待补充"
   *
   * false / 缺省:正常处理
   */
  isIncomplete?: boolean
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
   * 智能意图提取(多 chunk + 历史 task + 跨窗口上下文)
   *
   * 一次调用处理整个 ASR 窗口里的所有 chunk,LLM 看到完整对话上下文
   * (老板提议→产品讨论→老板决定)而不是孤立的一句话。
   *
   * @param chunks - 当前窗口里的全部 final chunk(按时间正序)
   * @param recentTasks - 历史 task(用于去重判断)
   * @param contextChunks - 跨窗口的历史 chunks(用于指代消解,
   *                      例如"这块/那个"指上文最近的名词短语)
   *                      这些 chunks 不会产生 intent,只作为上下文
   */
  async understand(
    chunks: AsrChunk[],
    recentTasks: RecentTaskSummary[] = [],
    contextChunks: AsrChunk[] = [],
  ): Promise<LlmUnderstandResult | null> {
    if (!this.apiKey) {
      logger.warn('LLM API key not set, skipping')
      return null
    }

    if (chunks.length === 0) {
      return { intents: [] }
    }

    const recentTasksText = recentTasks.length > 0
      ? '\n\n【全部已有 task 列表(去重判断的依据,必须逐条对照!)】\n' +
        recentTasks.map(t =>
          `- ${t.id.slice(0, 6)}: [${t.intent}] target="${t.target ?? '?'}" — ${t.interpreted} [${t.status}]`,
        ).join('\n')
      : ''

    // 把整个窗口转成对话片段(每条标了 ID + 说话人 + 时间,LLM 输出 sourceChunkId 可回链)
    const conversationText = chunks.map((c, i) => {
      const ts = new Date(c.timestamp).toISOString().slice(11, 19)
      return `[#${i + 1} ${ts} ${c.speaker}]: ${c.text}`
    }).join('\n')

    // ★ 跨窗口上下文(指代消解用):上文历史发言以 [CTX#N] 编号,跟当前窗口的 [#N] 区分开
    // LLM 可以用这些历史 chunks 解析"这块/那个" 的指代对象,但不会输出基于它们的 intent
    const contextText = contextChunks.length > 0
      ? '\n\n【上文历史(指代消解用,不会产生新 intent)】\n' +
        contextChunks.map((c, i) => {
          const ts = new Date(c.timestamp).toISOString().slice(11, 19)
          return `[CTX#${i + 1} ${ts} ${c.speaker}]: ${c.text}`
        }).join('\n')
      : ''

    const prompt = [
      '你是会议需求解析助手。给你一段会议对话片段(可能包含多轮发言),请提取出【所有】产品需求意图。',
      '',
      '【输入是完整对话片段,不是单条发言】请从【全部对话】中提取意图,不要遗漏。',
      '同一段对话里可能同时包含:老板的提议 + 产品经理的同意 + 老板的新需求 → 多个 intent。',
      '每条 intent 在 rawText 里写**完整的原文**(拼接多句完整发言;不是截取片段)。',
      '每条 intent 必须标注 sourceChunkId(引用对话里那条发言的编号 #1/#2/...)用于前端回链。',
      '',
      '【对话片段】',
      conversationText,
      contextText,
      recentTasksText,
      '',
      '【⚠️ 最高优先级:去重(逐条对照上面的 task 列表!)⚠️】',
      '如果某条发言描述的修改对象(target)与已有 task 相同或高度相似:',
      '  → 不要输出新的需求 intent!',
      '  → 输出 intent=approval 且 relationTo 指向那个已有 task(type=approval)。',
      '只有当对象【完全不同】时才输出新的 add/modify/delete/fix intent。',
      '例:已有 task target="header颜色",发言"头那个条再改蓝" → 同对象 → approval,不建新。',
      '',
      '【规则 1:区分意图和确认】',
      '- 【意图类】提出新需求 / 修改 / 删除 / 补充(有明确新对象)→ 创建 task',
      '- 【确认类】赞同("好的"、"可以"、"改吧"、"没问题"、"到时候去改")、重复同一诉求 → intent=approval,不创建新 task',
      '',
      '【规则 2:每个意图独立】一段对话里的多个【不同对象】的动作必须拆成多个 intent。',
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
      '【规则 6:截断检测 — 必须为每条发言评估完整性】',
      '你的输入可能包含【不完整】的发言,特征:',
      '  - 以语气词结尾:嗯 / 啊 / 呃 / 那个 / 这个 / 就是 / 吧 / 呢',
      '  - 以省略号结尾:… / ...',
      '  - 内容只有寒暄或铺垫,没有具体动作:"嗯那个客户列表…"(没下文)',
      '  - 含"等下/待会/我想想/回头"等表态未完的词',
      '  - 老板/PM 还在酝酿、可能随时接下文',
      '',
      '判断每条发言是否完整:',
      '  - 完整(intent 能执行)→ 正常输出该 intent,isIncomplete 不写或 false',
      '  - 不完整(还在酝酿/话没说完)→ isIncomplete: true',
      '    这种情况下 intent 字段可以随便填(如 "unknown"),target 为 null,confidence 任意',
      '    **不要瞎猜需求**,只标记等下一波补全',
      '',
      '你的输入可能包含【不完整】的发言,特征:',
      '  - 以语气词结尾:嗯 / 啊 / 呃 / 那个 / 这个 / 就是 / 吧 / 呢',
      '  - 以省略号结尾:… / ...',
      '  - 内容只有寒暄或铺垫,没有具体动作:"嗯那个客户列表…"(没下文)',
      '  - 含"等下/待会/我想想/回头"等表态未完的词',
      '  - 老板/PM 还在酝酿、可能随时接下文',
      '',
      '判断每条发言是否完整:',
      '  - 完整(intent 能执行)→ 正常输出该 intent,isIncomplete 不写或 false',
      '  - 不完整(还在酝酿/话没说完)→ isIncomplete: true',
      '    这种情况下 intent 字段可以随便填(如 "unknown"),target 为 null,confidence 任意',
      '    **不要瞎猜需求**,只标记等下一波补全',
      '',
      '【规则 7:对象明确的多意图必须拆分】',
      '一段对话里有 N 个【对象明确不同】的动作,必须输出 N 个 intent,不要合并。',
      '不要因为"主题相关"就合并(intent 维度拆分,不是 topic 维度合并)。',
      '不要为了凑数强行拆分模糊需求 —— 对象不明确的宁愿丢弃(给到 dsh 它也不知道改什么)。',
      '例:',
      '  老板: "页面布局冗杂,删掉智能体能力评估"',
      '  → 2 个 intent(对象不同):',
      '    1. modify-feature target="页面布局"(优化布局)',
      '    2. delete-feature target="智能体能力评估"',
      '',
      '【规则 8:指代消解(这块/那个/它/这块儿)】',
      '中文口语频繁用代词,按以下优先级解析:',
      '  1. 看【上文历史】([CTX#1] [CTX#2] ...) 或【本窗口上文】(#1 #2 ...)最近提到的名词短语',
      '  2. 找到 → 用上文对象作为 target(不标 isIncomplete,指代明确就完整)',
      '  3. 找不到 → confidence<0.7,不输出(intent 等下一波)',
      '例:',
      '  [CTX#1 老板]: 我觉得智能体能力评估这一块儿',
      '  [#1 老板]: 这块可以直接删了',
      '  → [#1] 的 target = "智能体能力评估"(继承 CTX#1 的对象),intent=delete-feature',
      '  → 不要标 isIncomplete(指代已明确)',
      '',
      '【规则 9:每条发言单独判断完整性(关键!)】',
      '逐 chunk 判断完整性,但关键是:**有明确动作 + 明确对象 → 完整**(即使以"呃" 开头)。',
      '  - 仅寒暄/语气词("嗯"、"啊"、"呃呃") → isIncomplete=true',
      '  - 动作动词 + 明确对象 → 完整(不要因"呃"开头就判 incomplete)',
      '  - 动作 + 指代词 + 上文有对象 → 完整(指代消解,见规则 8)',
      '  - 动作 + 指代词 + 上文无对象 → isIncomplete=true(等下文)',
      '  - 末尾是省略号/还在酝酿/等下说完 → isIncomplete=true',
      '',
      '【规则 10:同一对象被多次提及的处理】',
      '同一对象的多次提及,**必须先看已有 task 的 status 字段再判断**(见规则 11):',
      '  - 相同动作(都改/都删)+ status=completed/executing → 后续输出 approval(去重)',
      '  - 不同动作(之前改 / 现在删) → 第二个输出 supersedes 或 rejects',
      '  - 补充描述(布局冗杂 → 模块看不清楚) → 第二个输出 extends(同一对象的不同方面)',
      '',
      '【规则 11:基于已有 task 状态决定新建 vs approval(关键!)】',
      '已有 task 的 status 字段是判断依据。同一对象的多次提及,**根据 status 决定怎么处理**:',
      '  - status = completed / executing → 重复提及 = approval(任务已完成,用户在确认)',
      '  - status = confirmed / detected / analyzing → 重复提及 = approval(任务在流程中,用户在跟进)',
      '  - status = failed / rejected → **重复提及 = 新建 task**(之前的没成功,用户想要重试)',
      '    例: task cxSEGJKx [add-feature] status=failed',
      '         用户:"实施调用日志这块还是没加东,我现在需要你帮我加一些调用的日志"',
      '         → 不输出 approval,新建 task(add-feature target=实施调用日志,重新尝试)',
      '  - status = superseded → 重复提及 = approval(已被取代,不需要再建)',
      '  - status = deferred → 重复提及 = approval(用户暂存中,不需要再建)',
      '',
      '【输出格式 - 必须是严格合法的 JSON(所有 key 和 value 都带双引号)】',
      '只输出 JSON,不要 markdown 代码块,不要任何解释文字。',
      '每条 intent 必填 sourceChunkId(对应输入对话里的 #1/#2/... 编号,不是 CTX 编号)。',
      'isIncomplete 是可选字段:只有不完整才写 true,完整的省略或写 false。',
      '',
      '【示例 1:多意图拆分 + 指代消解(关键场景)】',
      '对话:',
      '[#1 10:00 老板]: 现在这个页面布局有点太冗杂了,然后每一个模块儿有点看不清楚',
      '[#2 10:01 老板]: 呃,我觉得智能体能力评估这一块儿,这块可以直接删掉了',
      '已有 task: tYrGhP [modify-feature] target="页面布局" [status=analyzing]',
      '输出:',
      '{"intents":[',
      '  {"intent":"modify-feature","sourceChunkId":"1","rawText":"现在这个页面布局有点太冗杂了,然后每一个模块儿有点看不清楚","interpreted":"优化页面布局,让每个模块更清晰","target":"页面布局","confidence":0.88,"relationTo":{"taskId":"tYrGhP","type":"extends"},"reasoning":"补充布局优化的具体表现(模块看不清楚),同一对象扩展"},',
      '  {"intent":"delete-feature","sourceChunkId":"2","rawText":"呃,我觉得智能体能力评估这一块儿,这块可以直接删掉了","interpreted":"删掉智能体能力评估模块","target":"智能体能力评估","confidence":0.95,"relationTo":null,"reasoning":"指代词\"这块\"继承 #1 的对象,新对象需要删除"}',
      ']}',
      '',
      '【示例 2:基于 task 状态判断(关键)】',
      '对话:',
      '[#1 10:00 老板]: 实施调用日志这块还是没有加东,我现在需要你帮我加一些调用的日志',
      '已有 task: cxSEGJKx [add-feature] target="实施调用日志" [status=failed]',
      '输出:',
      '{"intents":[{"intent":"add-feature","sourceChunkId":"1","rawText":"实施调用日志这块还是没有加东,我现在需要你帮我加一些调用的日志","interpreted":"添加实施调用日志","target":"实施调用日志","confidence":0.95,"relationTo":null,"reasoning":"已有 task cxSEGJKx status=failed,之前的没成功,用户重提需要新建 task 重试,不是 approval"}]}',
      '',
      '【示例 2:重复诉求(去重!)】',
      '已有 task:abc123 [modify-feature] target="表头颜色" — 将表头改为蓝色',
      '对话:',
      '[#1 10:00 老板]: 那个表头再改成蓝色吧',
      '输出:',
      '{"intents":[{"intent":"approval","sourceChunkId":"1","rawText":"那个表头再改成蓝色吧","interpreted":"重复诉求:将表头改为蓝色","target":"表头颜色","confidence":0.9,"relationTo":{"taskId":"abc123","type":"approval"},"reasoning":"对象与已有task abc123相同,是重复提及"}]}',
      '',
      '【示例 3:纯确认】',
      '已有 task:abc123 [modify-feature] target="表头颜色"',
      '对话:',
      '[#1 10:00 产品]: 好的,改吧',
      '输出:',
      '{"intents":[{"intent":"approval","sourceChunkId":"1","rawText":"好的,改吧","interpreted":"同意执行","target":null,"confidence":0.95,"relationTo":{"taskId":"abc123","type":"approval"},"reasoning":"纯确认话"}]}',
      '',
      '【示例 4:截断发言(不完整,等后续)】',
      '对话:',
      '[#1 10:00 老板]: 嗯那个客户列表',
      '[#2 10:00 老板]: 等下说完…',
      '输出:',
      '{"intents":[{',
      '  "intent":"unknown","sourceChunkId":"1","rawText":"嗯那个客户列表","interpreted":"发言被截断,等待补充","target":null,"confidence":0.0,"relationTo":null,"reasoning":"明显未说完,只标记等补全","isIncomplete":true',
      '},{',
      '  "intent":"unknown","sourceChunkId":"2","rawText":"等下说完…","interpreted":"发言被截断,等待补充","target":null,"confidence":0.0,"relationTo":null,"reasoning":"明确表态未完","isIncomplete":true',
      '}]}',
      '',
      '【示例 5:无意图】',
      '对话:',
      '[#1 10:00 老板]: 嗯嗯',
      '输出:',
      '{"intents":[]}',
      '',
      '【示例 6:对象模糊 → 丢弃(不勉强输出)】',
      '对话:',
      '[#1 10:00 老板]: 嗯那个(还没说具体改什么)',
      '上文历史: [CTX#1 老板]: "我们改一下"',
      '输出:',
      '{"intents":[{"intent":"unknown","sourceChunkId":"#1","rawText":"嗯那个","interpreted":"发言被截断,等待补充","target":null,"confidence":0.0,"relationTo":null,"reasoning":"指代词\"那个\"无明确上文对象,丢弃","isIncomplete":true}]}',
      '  —— 备注:目标不明确的需求,dsh 接到也不知道改什么,宁可丢弃不输出。',
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
      parsed.intents = parsed.intents.filter(i =>
        // 截断标记的 intent 即使 confidence 低也不能丢(要传给 engine 等补全)
        i.isIncomplete === true || (i.confidence || 0) >= 0.6,
      )

      // 反查 sourceChunkId:#1 → chunks[0].id
      // 兼容 LLM 输出字符串数字("1" / "#1")
      for (const intent of parsed.intents) {
        const raw = intent.sourceChunkId
        if (typeof raw === 'string') {
          const n = parseInt(raw.replace(/^#/, ''), 10)
          if (Number.isFinite(n) && n >= 1 && n <= chunks.length) {
            intent.sourceChunkId = chunks[n - 1].id
          } else {
            intent.sourceChunkId = null
          }
        }
      }

      return parsed
    } catch (err) {
      logger.error({ err }, 'LLM understand failed')
      return null
    }
  }

  /**
   * LLM 可行性评估
   *
   * 输入:task + codeMap + projectType(纯 HTML / 框架)
   * 输出:Feasibility { technical, workload, riskLevel, inWhitelist, codeMapRefs, reasoning }
   *
   * 决策层只判断"该不该做",不管"做没做成"。
   * dsh 后续执行失败不会改变这里评估的结果(feasibility 标记不可变)。
   *
   * 失败返回 null,调用方应 fallback 到规则评估。
   */
  async evaluateFeasibility(
    task: Task,
    codeMap: CodeMap | null,
    projectType: 'pure-html' | 'framework' = 'framework',
  ): Promise<Feasibility | null> {
    if (!this.apiKey) {
      logger.warn('LLM API key not set, skipping feasibility evaluation')
      return null
    }

    const prompt = this.buildFeasibilityPrompt(task, codeMap, projectType)

    try {
      const text = await this.callClaude(prompt, 1024)
      if (!text) return null

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        logger.warn({ text: text.slice(0, 500) }, 'feasibility response did not contain JSON')
        return null
      }

      let parsed: Feasibility
      try {
        parsed = JSON.parse(jsonMatch[0]) as Feasibility
      } catch {
        try {
          parsed = JSON.parse(jsonMatch[0].replace(/,\s*([}\]])/g, '$1')) as Feasibility
        } catch (err) {
          logger.warn({ raw: jsonMatch[0].slice(0, 400), err: String(err) }, 'feasibility JSON unparseable')
          return null
        }
      }

      // 字段校验
      if (
        typeof parsed.technical !== 'string' ||
        typeof parsed.workload !== 'string' ||
        typeof parsed.riskLevel !== 'string' ||
        typeof parsed.inWhitelist !== 'boolean' ||
        typeof parsed.reasoning !== 'string'
      ) {
        logger.warn({ parsed }, 'feasibility response missing required fields')
        return null
      }

      return {
        technical: parsed.technical,
        workload: parsed.workload,
        riskLevel: parsed.riskLevel,
        inWhitelist: parsed.inWhitelist,
        codeMapRefs: Array.isArray(parsed.codeMapRefs) ? parsed.codeMapRefs : [],
        reasoning: parsed.reasoning,
      }
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'LLM feasibility evaluation failed')
      return null
    }
  }

  /** 构造可行性评估 prompt */
  private buildFeasibilityPrompt(
    task: Task,
    codeMap: CodeMap | null,
    projectType: 'pure-html' | 'framework' = 'framework',
  ): string {
    const transcript = task.source.transcript
      .map(s => `[${s.speaker}] ${s.text}`)
      .join('\n')

    const codeMapSummary = codeMap
      ? [
        `框架: ${codeMap.framework}`,
        `组件(${codeMap.components.length}):`,
        codeMap.components.slice(0, 30).map(c => `  - ${c.path}${c.description ? ` (${c.description})` : ''}`).join('\n'),
        `API 路由(${codeMap.apiRoutes.length}):`,
        codeMap.apiRoutes.slice(0, 15).map(r => `  - ${r.path}`).join('\n'),
      ].join('\n')
      : '无可用 CodeMap'

    // ★ 按项目类型分流白/黑名单
    const whitelist = projectType === 'pure-html'
      ? [
        '## 白名单(允许改动)',
        '- HTML 标签、CSS 样式、内联 JS、静态资源',
        '- .js 文件(纯前端逻辑,不依赖 Node 服务端)',
      ].join('\n')
      : [
        '## 白名单(允许改动)',
        '- 前端原型(组件 / 页面 / 样式 / CRUD / 字段展示)',
      ].join('\n')

    const blacklist = projectType === 'pure-html'
      ? [
        '## 黑名单(必须判为不可行)',
        '- Node 服务端代码',
        '- 数据库 / SQL',
        '- 后端 API 端点',
        '- 构建脚本(wait,等等,纯 HTML 是不需要 build 的)',
      ].join('\n')
      : [
        '## 黑名单(必须判为不可行)',
        '- 路由(router/Route 配置)',
        '- 权限(auth/login/permission)',
        '- 数据库 schema(Prisma / 迁移)',
        '- 后端 API 接口',
        '- 第三方 SDK 集成',
        '- 支付/部署相关',
      ].join('\n')

    return [
      '你是项目可行性评估助手。判断一个【已经被识别为产品需求】的任务是否在允许范围内可以执行。',
      '',
      '# 决策层职责:判断该不该做(不判断做没做成)',
      '你只评估"这个需求 AI 能不能改"。"能不能改成功"由后续 dsh 执行层决定,不在你的职责范围内。',
      '',
      `# 项目类型: ${projectType}`,
      '',
      '# 项目信息',
      whitelist,
      '',
      blacklist,
      '',
      '# Code Map',
      codeMapSummary,
      '',
      '# 任务',
      `intent: ${task.requirement.intent}`,
      `interpreted: ${task.requirement.interpreted}`,
      `target: ${task.llm?.target ?? '(none)'}`,
      '',
      '## 会议讨论原文',
      transcript,
      '',
      '# 输出格式(严格 JSON)',
      '{',
      '  "technical": "feasible" | "infeasible" | "unknown",',
      '  "workload": "small" | "medium" | "large",',
      '  "riskLevel": "low" | "medium" | "high",',
      '  "inWhitelist": true | false,',
      '  "codeMapRefs": ["src/components/X.tsx"],  // 最相关的文件路径(0-3个)',
      '  "reasoning": "具体说明为什么这么评估"',
      '}',
      '',
      '# 评估要点',
      projectType === 'pure-html'
        ? [
          '- 涉及服务端/数据库/构建 → inWhitelist=false, riskLevel="high"',
          '- 改多个 .html 文件 → workload="medium"',
          '- 改单个 .html 标签/CSS → workload="small", riskLevel="low"',
          '- 倾向宽容(纯 HTML 任务简单,fast feedback)',
        ].join('\n')
        : [
          '- 涉及黑名单内容(路由/权限/数据库/支付/部署)→ inWhitelist=false, riskLevel="high"',
          '- 涉及"整套/全部/整个/所有页面" → workload="large"',
          '- 涉及多个组件协同改 → workload="medium"',
          '- 改单个组件/加个字段 → workload="small", riskLevel="low"',
          '- 不确定时倾向保守(riskLevel 偏高、inWhitelist 偏 false)',
        ].join('\n'),
      '- technical 字段:feasible 表示技术能做,infeasible 表示技术不可行(unknown 慎用)',
      '',
      '只输出 JSON,不要任何其他文字。',
    ].join('\n')
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
