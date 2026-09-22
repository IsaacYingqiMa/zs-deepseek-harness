# Meeting Assistant Web

实时会议助手的自研前端。

## 启动

```bash
# 在 monorepo 根目录安装依赖
cd D:\InspurCode\zs-deepseek-harness
pnpm install

# 启动开发服务器
cd apps/meeting-assistant
pnpm dev
```

浏览器打开 `http://localhost:4000`

## 界面布局

```
┌─────────────────────────────────────────────┐
│ [项目选择]  [录音控制]                       │
├──────────┬──────────────────┬──────────────┤
│ 实时转写  │  任务清单         │  实时预览    │
│          │  (可点击展开)     │  (iframe)    │
│          │                  │              │
│          ├──────────────────┤              │
│          │  AI 思考流        │              │
└──────────┴──────────────────┴──────────────┘
```

## 关键组件

- `ProjectPicker` - 项目选择(从后端扫描)
- `RecorderPanel` - 录音控制 + WebSocket 状态
- `TranscriptStream` - 实时转写流
- `TaskList` - 任务清单(可点击展开 ASR 原文 + 判断链 + 执行进度)
- `AiReasoningStream` - AI 思考流(底部)
- `PreviewPanel` - iframe 预览(右侧)

## 数据流

```
useEventStream() 订阅 /ws/events
  ├─ asr/chunk      → TranscriptStream
  ├─ task/created   → TaskList
  ├─ task/*         → TaskList + AiReasoningStream
  ├─ judgment/*     → AiReasoningStream
  ├─ execution/log  → TaskList (展开后)
  └─ queue/state    → TaskList (执行中提示)

useRecorder() 录音 + 发到 /ws/audio
```