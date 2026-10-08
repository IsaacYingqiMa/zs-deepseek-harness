# 大屏展示模板 — AI 改造指令(AIPROMPT.md)

## 项目类型
**纯 HTML 前端** + 原生 JS + 内联 SVG / Canvas 图表。无构建系统,无 npm 依赖。

## 项目结构
```
dashboard-demo/
├── index.html              # 网格布局(KPI + 图表 + 活动流)
├── css/
│   └── theme.css           # ★ 主题样式(暗色科技感)— 可改
├── js/
│   ├── app.js              # 主流程 + 初始化(不可改)
│   ├── data.js             # ★ Mock 数据 — 可改
│   ├── kpi.js              # 4 个 KPI 卡渲染(★ 可改:加指标)
│   ├── chart.js            # 柱状图(native canvas)(可改)
│   └── activity.js         # 活动流(★ 可改)
└── AIPROMPT.md             # 本文件
```

## ★ 可改区(AI 只能改这些)

### 数据
- `js/data.js` — `METRICS`、`CHART_DATA`、`ACTIVITIES` 三个数组的内容

### 样式
- `css/theme.css` — 颜色 / 字体 / 间距 / 阴影 / 圆角
- `index.html` 的内联 `<style>` — 网格布局(可改 grid 配置)

### 渲染逻辑
- `js/kpi.js` — KPI 卡渲染(`renderKPIs` 函数)
- `js/chart.js` — 柱状图(`renderChart` 函数)
- `js/activity.js` — 活动流(`renderActivities` 函数)

## ✗ 不可改区

- `index.html` 的 DOM 结构(KPI 容器 + 图表 canvas + 活动流容器 + 版本号徽章)— 可改 class 名
- `js/app.js` 主流程(初始化 + 轮询 + 版本号徽章拉取)
- 文件结构(不新建文件)
- 引入顺序(单 JS 文件,顺序很重要)
- `data/version.json` — **系统自动写,不要改**(AI 改这个会让版本号错乱)

## 默认布局(2x2 + 1 全宽)

```
┌─────────────────────────────────────────────────┐
│  4 个 KPI 卡(横向)                              │
├──────────────────────┬──────────────────────────┤
│  柱状图(左 2/3)      │  活动流(右 1/3)         │
│                      │                          │
└──────────────────────┴──────────────────────────┘
```

## 改造示例

| 用户说 | 改哪里 | 改什么 |
|---|---|---|
| "右上角加一个退货率" | `js/kpi.js` 加渲染函数 + `index.html` 加容器 + `js/app.js` init 里调用 | ⚠ 会动到不可改区,需要用户明确 |
| "改色,蓝色科技感" | `css/theme.css` | 改 `--primary`、`--bg` |
| "柱状图换成折线图" | `js/chart.js` | 改 `renderChart`,改 canvas 绘制逻辑 |
| "活动流加个用户头像" | `js/activity.js` + `css/theme.css` | 数据加 avatar 字段,CSS 加 `.avatar` 样式 |
| "多加一点统计数据" | `js/data.js` 的 `METRICS` / `CHART_DATA` / `ACTIVITIES` / `SHARE_DATA` 任一数组 | 加 1-2 个新条目 |
| "加一个地图组件" | ⚠ 不要做 | 涉及新组件,会让代码超 8 个工具调用 |

## 硬约束

1. **不要 npm install / build / dev**(纯 HTML)
2. **不要跑 lint/test**(没有这些工具)
3. **不要新建文件**
4. **改完立即结束**
5. **不要超过 8 个工具调用**

## 修改流程

1. `list_files`(1 次)
2. `read_file` 读 1-2 个相关文件
3. `edit_file` / `write_file` 精准改
4. 回复"✅ 完成 + [改动文件]"

## 默认色板(暗色科技感)

```
--bg:         #0a0e27  /* 深蓝黑背景 */
--bg-card:    #131938  /* 卡片背景 */
--primary:    #00d4ff  /* 青蓝色 */
--success:    #10b981
--warning:    #fbbf24
--danger:     #ef4444
--text:       #e5e7eb  /* 主文字 */
--text-dim:   #9ca3af  /* 次要文字 */
```
