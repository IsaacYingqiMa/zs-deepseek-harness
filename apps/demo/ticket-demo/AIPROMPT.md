# 工单系统模板 — AI 改造指令(AIPROMPT.md)

## 项目类型
**纯 HTML 前端** + 原生 JS。无构建系统,无 npm 依赖,无框架。

## 项目结构
```
ticket-demo/
├── index.html              # 主框架:左侧菜单 + 右侧内容区
├── css/
│   ├── layout.css          # 整体布局(菜单 + 内容区)— 不可改
│   └── theme.css           # 颜色 / 字号 / 主题 — ★ 可改
├── js/
│   ├── app.js              # 路由 + 菜单初始化 — 不可改
│   ├── data.js             # ★ mock 数据(工单 / 用户)— 可改(增删条目)
│   └── pages/
│       ├── dashboard.js    # 首页(4 KPI 卡 + 最近 5 条)
│       ├── tickets.js      # ★ 工单列表 — 可改(加字段 / 加 Tab / 改筛选)
│       ├── ticket-detail.js# 详情页(评论 + 处理记录)
│       ├── new-ticket.js   # ★ 创建表单 — 可改(加字段)
│       └── settings.js     # 设置页
├── data/
│   ├── tickets.json        # ★ 工单数据(可改:增删 / 改字段)
│   └── config.json         # ★ 配置(分类 / 优先级 / 状态)— 可改
└── AIPROMPT.md             # 本文件
```

## ★ 可改区(AI 只能改这些)

### 数据类
- `data/tickets.json` — 工单数据(增删条目、改字段值)
- `data/config.json` — 状态 / 分类 / 优先级配置

### 样式类
- `css/theme.css` — 颜色 / 字号 / 主题色 / 间距
- `css/layout.css` — **可改**:padding / margin / 圆角 / 阴影。**不可改**:grid 结构、position absolute 定位

### 页面类(改对应文件的渲染逻辑)
- `js/pages/dashboard.js` — KPI 卡内容、最近工单列表
- `js/pages/tickets.js` — 列表渲染、筛选、Tab、表格列
- `js/pages/new-ticket.js` — 创建表单字段
- `js/pages/ticket-detail.js` — 详情展示、评论列表

### 数据加载类
- `js/data.js` — 数据导出结构、`loadTickets()` 等函数体

## ✗ 不可改区(改了会破坏项目)

- `index.html` — 主框架 DOM 结构(左侧菜单 + 右侧容器)。可改:文字标签
- `js/app.js` — 路由逻辑、菜单初始化、全局事件绑定、版本号徽章轮询逻辑
- 文件结构 — 不要新建文件、不要删除文件
- `package.json` — 不需要(纯 HTML 项目,无依赖)
- 任何 `<script>` 引入顺序
- `data/version.json` — **系统自动写,不要改**(AI 改这个会让版本号错乱)

## 改造示例(用户原话 → 怎么改)

| 用户说 | 改哪里 | 改什么 |
|---|---|---|
| "加个紧急程度字段" | `data/tickets.json` + `js/pages/tickets.js` + `css/theme.css` | JSON 加 `urgent: bool`,列表加显示列,CSS 加 `.urgent-row { background: red-50 }` |
| "状态改成 4 个 Tab" | `js/pages/tickets.js` | 把单一列表拆成 4 个 Tab(待办 / 处理中 / 已完成 / 已关闭) |
| "右上角加个搜索框" | `index.html`(加 DOM)+ `js/pages/tickets.js`(加逻辑) | HTML 加 input,tickets.js 加过滤函数 |
| "主题色换成蓝色" | `css/theme.css` | 改 `--primary` CSS 变量 |
| "加个报表页面" | **新建** `js/pages/reports.js` + `index.html`(加菜单项)+ `js/app.js`(注册路由) | ⚠ 这会动到不可改区。需要用户明确要求才做 |
| "工单加个评论功能" | `js/pages/ticket-detail.js` + `data/tickets.json` | JSON 加 `comments: []`,详情页加渲染 |

## 硬约束

1. **不要跑 npm/pnpm install**(纯 HTML,无依赖)
2. **不要跑 lint/build/test**(没有这些工具)
3. **不要新建 npm 依赖**
4. **不要改路由架构**(app.js 的 hash 路由逻辑)
5. **改完立即结束**,不要做"优化"已写代码
6. **不要超过 8 个工具调用**(这是 demo,目标小)

## 修改流程

1. `list_files` 看一遍项目结构(只需 1 次)
2. `read_file` 读 1-2 个相关文件
3. `edit_file` / `write_file` 精准修改
4. 回复"✅ 完成 + [改动文件列表]"

## 默认主题色(改色用)
```
--primary:   #4f46e5  /* 靛蓝 */
--success:   #10b981  /* 绿 */
--warning:   #f59e0b  /* 橙 */
--danger:    #ef4444  /* 红 */
--bg:        #f9fafb  /* 灰白背景 */
--text:      #1f2937  /* 深灰文字 */
```

## 默认状态(可在 config.json 改)
- 待办 / 处理中 / 已完成 / 已关闭
