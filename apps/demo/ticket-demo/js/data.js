/* ========================================
   data.js — Mock 数据(★ 可改)
   AI 可以增删条目 / 改字段值
   ======================================== */

// 模拟数据(AI 改这里增删工单)
const TICKETS = [
  {
    id: 'TK-001',
    title: '登录页面样式错乱',
    status: 'progress',
    priority: 'high',
    category: 'bug',
    assignee: '张三',
    createdAt: '2026-09-25 10:30',
    description: '登录按钮在 Safari 浏览器下显示位置错误',
  },
  {
    id: 'TK-002',
    title: '新增数据导出功能',
    status: 'pending',
    priority: 'medium',
    category: 'feature',
    assignee: '李四',
    createdAt: '2026-09-25 11:00',
    description: '用户希望能导出 Excel 格式的工单列表',
  },
  {
    id: 'TK-003',
    title: '优化报表加载速度',
    status: 'progress',
    priority: 'low',
    category: 'improve',
    assignee: '王五',
    createdAt: '2026-09-25 14:20',
    description: '当前加载需要 5 秒,目标 1 秒内',
  },
  {
    id: 'TK-004',
    title: '修复移动端布局问题',
    status: 'done',
    priority: 'medium',
    category: 'bug',
    assignee: '张三',
    createdAt: '2026-09-24 09:15',
    description: 'iPhone 上列表显示不全',
  },
  {
    id: 'TK-005',
    title: '集成 Slack 通知',
    status: 'closed',
    priority: 'low',
    category: 'feature',
    assignee: '赵六',
    createdAt: '2026-09-23 16:40',
    description: '工单状态变更时推送 Slack',
  },
  {
    id: 'TK-006',
    title: '数据库备份脚本',
    status: 'pending',
    priority: 'high',
    category: 'task',
    assignee: '未分配',
    createdAt: '2026-09-26 09:00',
    description: '每天凌晨自动备份',
  },
];

// 系统配置(AI 改这里改状态 / 分类 / 优先级)
const CONFIG = {
  statuses: [
    { value: 'pending', label: '待办', tagClass: 'tag-pending' },
    { value: 'progress', label: '处理中', tagClass: 'tag-progress' },
    { value: 'done', label: '已完成', tagClass: 'tag-done' },
    { value: 'closed', label: '已关闭', tagClass: 'tag-closed' },
  ],
  priorities: [
    { value: 'high', label: '高' },
    { value: 'medium', label: '中' },
    { value: 'low', label: '低' },
  ],
  categories: [
    { value: 'bug', label: 'Bug' },
    { value: 'feature', label: '功能' },
    { value: 'improve', label: '改进' },
    { value: 'task', label: '任务' },
  ],
};

// 暴露到全局(window)供其他 JS 使用
window.TICKETS = TICKETS;
window.CONFIG = CONFIG;
