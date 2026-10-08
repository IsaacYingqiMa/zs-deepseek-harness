/* ========================================
   data.js — Mock 数据(★ 可改)
   AI 可以:增删条目、改字段值
   ======================================== */

// KPI 指标(AI 可改:加新指标、调整数值)
const METRICS = [
  {
    id: 'orders',
    label: '今日订单',
    value: 1286,
    unit: '',
    trend: 12,
    trendDir: 'up',
    icon: '📦',
  },
  {
    id: 'revenue',
    label: '今日营收',
    value: 58.4,
    unit: '万',
    trend: 8.5,
    trendDir: 'up',
    icon: '💰',
  },
  {
    id: 'users',
    label: '活跃用户',
    value: 3421,
    unit: '',
    trend: 3.2,
    trendDir: 'up',
    icon: '👥',
  },
  {
    id: 'conversion',
    label: '转化率',
    value: 4.8,
    unit: '%',
    trend: 0.5,
    trendDir: 'down',
    icon: '🎯',
  },
  {
    id: 'pageviews',
    label: '页面浏览',
    value: 86432,
    unit: '',
    trend: 15.4,
    trendDir: 'up',
    icon: '📈',
  },
  {
    id: 'aov',
    label: '客单价',
    value: 454,
    unit: '元',
    trend: 2.1,
    trendDir: 'up',
    icon: '🧾',
  },
  {
    id: 'refund',
    label: '退款率',
    value: 1.6,
    unit: '%',
    trend: 0.4,
    trendDir: 'down',
    icon: '↩️',
  },
  {
    id: 'newshare',
    label: '新客占比',
    value: 32.5,
    unit: '%',
    trend: 0,
    trendDir: 'flat',
    icon: '🆕',
  },
];

// 柱状图数据(最近 7 天)
const CHART_DATA = [
  { label: '周一', value: 920 },
  { label: '周二', value: 1050 },
  { label: '周三', value: 1180 },
  { label: '周四', value: 980 },
  { label: '周五', value: 1320 },
  { label: '周六', value: 1450 },
  { label: '周日', value: 1286 },
];

// 实时活动流
const ACTIVITIES = [
  { id: 1, type: 'success', icon: '✓', text: '用户 张三 下了订单 #ORD-9281', time: '刚刚' },
  { id: 2, type: 'info', icon: '👤', text: '新用户注册:李四', time: '1 分钟前' },
  { id: 3, type: 'warning', icon: '⚠', text: '系统告警:CPU 使用率达 85%', time: '3 分钟前' },
  { id: 4, type: 'success', icon: '✓', text: '订单 #ORD-9280 已发货', time: '5 分钟前' },
  { id: 5, type: 'info', icon: '💬', text: '客户 王五 提交了工单', time: '8 分钟前' },
  { id: 6, type: 'success', icon: '💰', text: '支付成功:¥1,299.00', time: '12 分钟前' },
  { id: 7, type: 'danger', icon: '✗', text: '订单 #ORD-9279 退款申请', time: '15 分钟前' },
  { id: 8, type: 'success', icon: '🎯', text: '转化率回升至 4.8%(目标 5.0%)', time: '18 分钟前' },
  { id: 9, type: 'info', icon: '🛒', text: '购物车新增高价值订单:¥8,650.00', time: '21 分钟前' },
  { id: 10, type: 'success', icon: '📦', text: '订单 #ORD-9278 已完成签收', time: '25 分钟前' },
  { id: 11, type: 'warning', icon: '⚠', text: '库存告急:SKU-3391 剩余 12 件', time: '28 分钟前' },
  { id: 12, type: 'info', icon: '👥', text: '渠道回流:小程序日活突破 9,200', time: '31 分钟前' },
  { id: 13, type: 'success', icon: '💬', text: '工单 #TK-4472 已闭环,满意度 5.0', time: '36 分钟前' },
];

// 渠道占比(环形图)
const SHARE_DATA = [
  { label: '线上商城', value: 45 },
  { label: '小程序', value: 28 },
  { label: '门店 POS', value: 17 },
  { label: '第三方', value: 10 },
];

// 暴露
window.METRICS = METRICS;
window.CHART_DATA = CHART_DATA;
window.SHARE_DATA = SHARE_DATA;
window.ACTIVITIES = ACTIVITIES;
