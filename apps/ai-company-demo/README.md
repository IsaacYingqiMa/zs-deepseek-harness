# FlowCRM AI Company · 拟人化演示

一个独立的、**纯前端**的 AI 公司自治可视化 demo。**不需要后端**,双击 `index.html` 即可运行(需要通过 HTTP server 打开,见下方说明)。

---

## 怎么打开

由于浏览器对 `file://` 协议下的 JS 模块加载有限制,推荐用本地 HTTP server:

### 方式 1:Python(最简单)

```bash
cd apps/ai-company-demo
python -m http.server 8080
```

打开 `http://localhost:8080`

### 方式 2:Node.js

```bash
cd apps/ai-company-demo
npx http-server -p 8080
```

### 方式 3:VSCode Live Server

如果你用 VSCode,装 Live Server 扩展,右键 `index.html` → "Open with Live Server"。

---

## 演示什么

7 个拟人化的 AI agent 角色在一个虚拟办公室里协同工作:

| 角色 | 位置 | 职责 |
|------|------|------|
| 董事长 | 顶部左侧 | 战略方向、最终拍板 |
| 总经理 | 顶部中间 | 战略 → 执行方案 |
| CTO | 顶部右侧 | 技术方案、plan_mode |
| PM | 中间 | PRD、协调团队 |
| 设计师 | 底部左侧 | 设计稿 |
| 研发 | 底部中间 | 代码 |
| 测试 | 底部右侧 | 测试 |

**演示剧本**:政府客户的标书审核智能体 MVP 需求(6 周交付)。

**完整剧情**:
1. 董事长收到客户邮件,发布战略清单
2. 与总经理多轮讨论(checklist 驱动)
3. 总经理 fork CTO,要求技术方案
4. CTO 进入 plan_mode,出技术方案
5. CTO 与总经理来回 push back(8 周 → 6 周)
6. CTO fork PM,出 PRD
7. PM 同时 fork 设计师/研发/测试 3 人
8. 三人并行工作(PM 中转协调)
9. 设计师 ↔ 研发通过 PM 沟通可行性
10. 测试发现 P0 bug,研发修复
11. PM 整合交付给 CTO
12. CTO 整合交付给总经理
13. 总经理 ACK 董事长
14. 7 张决策卡涌现,所有角色 ✓

全程 ~2 分钟,**没有用户操作**,AI 自主运转。

---

## 视觉元素

### 7 个角色(每个)

- 头部(圆形,渐变阴影)
- 眼睛(会动:思考时眯眼,工作时睁大)
- 嘴巴(状态变化)
- 身体(角色配色 + 渐变 + 阴影)
- Name tag(名字牌)
- 手臂(打字时摆动)
- Status LED(头顶小灯,绿/黄/蓝/橙/绿对应不同状态)
- Thought bubble(思考时出现)
- Speech bubble(发消息时显示内容)
- Tool icon(头顶显示当前工具:bash ⌨️ / web 🔍 / fs 📁 / fork 👶)
- Done checkmark(完成后)

### 5 个状态动画

| 状态 | 视觉 |
|------|------|
| Idle | 轻微上下浮动 + 偶发眨眼 |
| Thinking | 头微倾 + 眼睛眯起 + 💭 气泡脉冲 |
| Working | 手臂敲打 + 工具图标 + 头部微移 |
| Sending | 嘴张开 + 语音气泡显示消息 |
| Meeting | 嘴张开微笑 + 手臂上下抬(说话姿势) |
| Done | ✓ 标记 + 眯眼笑 |

### 通信动画

- 信封从发送方飞到接收方(1.4s 弧线 + 旋转)
- 信封上有简短消息文字预览
- 接收方 LED 闪烁接收提示

### 决策卡(涌现式)

从屏幕右侧滑入,每个决策:
- 颜色对应角色(董事长紫、总经理蓝、CTO 绿、PM 橙、Designer 粉、Dev 青、Test 黄)
- 头部 = 决策标题(粗体)
- 主体 = 决策依据
- 编号自动增加,右上角统计

### 实时事件流(底部)

所有事件按时间倒序滚动,每条带:
- 时间戳
- 类型图标(💭思考 / ✉️发送 / 🔧干活 / ✓完成 / 👶fork)
- 角色名(粗体)
- 事件描述

### 顶部状态栏

- ⏱ 已运行时间(实时)
- 📋 决策数
- ✉️ 消息数
- 👤 活跃角色数 / 总角色数

---

## 控件

只有 3 个按钮,放右上角:

- **▶ 开始演示** - 重置 + 自动播放
- **⏸ 暂停** - 暂停时间(再按 ▶ 继续)
- **↻ 重播** - 重新开始

**没有"下一步"按钮**。AI 自己决定下一步。

---

## 自定义剧本

要改剧本,编辑 `app.js` 里的 `runScript()` 函数。所有事件用 `scriptEvent(time, fn)` 调度:

```js
scriptEvent(t(1000), function () {
  spawnCharacter('chairman');
  setState('chairman', 'idle');
});

scriptEvent(t(3000), function () {
  setState('chairman', 'thinking');
  addEvent('💭', '董事长', '收到邮件', 'thinking');
});
```

可用时间常量参考 `runScript()` 中的注释(`t()` 函数会把毫秒数乘以 `TIME_SCALE`,默认 1.0 = 实时)。

可用 API:
- `spawnCharacter(role)` / `setState(role, state)` - 角色生命周期
- `moveCharacter(role, x%, y%)` - 移动角色
- `publishChecklist(role, title, items)` / `checkChecklistItem(role, i)` - checklist
- `showSpeech(role, text)` - 语音气泡
- `flyEnvelope(from, to, text)` - 飞信
- `showDecision(role, type, headline, body)` - 决策卡
- `addEvent(icon, actor, text, type)` - 事件流

---

## 文件结构

```
ai-company-demo/
  index.html       # 主页面 + CSS (~600 行)
  app.js           # 剧本引擎 + 状态机 + 第一个剧本 (~700 行)
  README.md        # 本文件
```

零依赖、零构建。双击 `index.html`(通过 HTTP server)即可演示。

---

## 局限

- 单剧本(标书审核 MVP)。要加更多剧本可以 fork `runScript()` 写成多个版本。
- 没有持久化。刷新页面状态丢失(剧本是固定的)。
- 响应式不够,推荐 ≥ 1280×800 屏幕。
- 没有真实接入 DSH API。当前是 mock 数据驱动。

---

## 后续可扩展

- 接 DSH 的 session event stream → 用真实 AI agent 跑这个剧本
- 加 React 版本(Lottie 动画 + 状态管理)
- 加多剧本切换器
- 加"董事长介入"按钮 → 用户可以注入新指令,看 AI 如何应对
