# Meeting Assistant Server

实时会议助手的后端核心。

## 职责

1. **ASR 中转**: 浏览器音频 → FunASR 识别 → 转写 chunks
2. **独立判断层**: 持续监听 + 规则/LLM 辅助 + Task 状态机 + 调度
3. **dsh 集成**: 创建 session + 发 prompt + 订阅 SSE + 解析事件
4. **项目管理**: 扫描项目 + 启动 dev server + 生成 Code Map
5. **API**: REST + WebSocket,供前端调用

## 启动

```bash
# 1. 安装依赖(在 monorepo 根目录)
cd D:\InspurCode\zs-deepseek-harness
pnpm install

# 2. 配置环境变量
cd apps/meeting-assistant-server
cp .env.example .env
# 编辑 .env

# 3. 启动 dsh 后端(另一个终端)
cd D:\InspurCode\zs-deepseek-harness
pnpm dsh web

# 4. 启动自研后端
cd apps/meeting-assistant-server
pnpm dev
```

## 架构

```
浏览器 → WebSocket:音频 → 后端 → FunASR
                          ↓
                     转写 chunks
                          ↓
              独立判断层(状态机 + 规则 + LLM)
                          ↓
                    触发执行条件满足
                          ↓
                  HTTP prompt → dsh 后端
                          ↓
                  SSE 事件流 → 前端 + 判断层
```

## 端口

- `5174` 自研后端 REST + WebSocket
- `5173` 自研前端(Vite)
- `10095` FunASR(用户服务器)
- `3080` dsh 后端(默认)
- `3000` demo 项目 dev server

## 关键文件

- `src/types/task.ts` - 所有类型定义
- `src/judgment/judgment-engine.ts` - 判断引擎主入口
- `src/judgment/rule-engine.ts` - 规则匹配
- `src/judgment/scheduler.ts` - dsh 调度器
- `src/dsh-adapter/session-manager.ts` - dsh 集成
- `src/server.ts` - 入口