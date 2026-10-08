/* ========================================
   activity.js — 实时活动流 + 大屏自动刷新(★ 可改)
   AI 可以:加条目类型、改样式、加新字段
   ======================================== */

window.renderActivities = function () {
  const container = document.getElementById('activity-container');
  if (!container) return;

  const acts = window.ACTIVITIES || [];

  // 只渲染能放得下的条目,保证一屏内显示、不溢出
  const row = () =>
    '<div class="activity-item">'
    + '<div class="activity-icon TYPE">ICON</div>'
    + '<div class="activity-content">'
    + '<div class="activity-text">TEXT</div>'
    + '<div class="activity-time">TIME</div>'
    + '</div></div>';

  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = '<div class="activity-icon"></div><div class="activity-content">'
    + '<div class="activity-text">0</div><div class="activity-time">0</div></div>';
  container.textContent = '';
  container.appendChild(item);
  const rowH = item.getBoundingClientRect().height || 0;
  container.removeChild(item);

  const fit = rowH > 0 ? Math.max(1, Math.floor(container.clientHeight / rowH)) : acts.length;
  container.innerHTML = acts
    .slice(0, fit)
    .map((a) => row()
      .replace('TYPE', a.type)
      .replace('ICON', a.icon)
      .replace('TEXT', a.text)
      .replace('TIME', a.time))
    .join('');

  startAutoRefresh();
};

// ---------- 自动刷新:KPI + 柱状图/环形图 跟着活动流一起动起来 ----------
const REFRESH_MS = 5000;

function jitterMetrics() {
  (window.METRICS || []).forEach((m) => {
    // 首次抖动时记下基准值,之后围绕基准上下浮动,不会一路漂走
    if (m._base === undefined) m._base = m.value;
    const base = m._base;
    const spread = base * 0.03;
    const decimals = Number.isInteger(base) ? 0 : 1;
    const next = base + (Math.random() * 2 - 1) * spread;
    m.value = Number(next.toFixed(decimals));
    m.trend = Number((m.trend + (Math.random() * 2 - 1) * 0.6).toFixed(1));
    m.trendDir = m.trend > 0.3 ? 'up' : m.trend < -0.3 ? 'down' : 'flat';
  });
}

function jitterChart() {
  (window.CHART_DATA || []).forEach((d) => {
    if (d._base === undefined) d._base = d.value;
    const next = d._base + (Math.random() * 2 - 1) * d._base * 0.05;
    d.value = Math.round(next);
  });
  (window.SHARE_DATA || []).forEach((s) => {
    if (s._base === undefined) s._base = s.value;
    const next = s._base + (Math.random() * 2 - 1) * 2;
    s.value = Math.max(1, Math.round(next));
  });
}

function refreshDashboard() {
  jitterMetrics();
  jitterChart();
  if (typeof window.renderKPIs === 'function') window.renderKPIs();
  if (typeof window.renderChart === 'function') window.renderChart();
  if (typeof window.renderActivities === 'function') window.renderActivities();
}

function startAutoRefresh() {
  // 只装一次定时器,避免重复渲染时叠出多个 interval
  if (window.__autoRefreshOn) return;
  window.__autoRefreshOn = true;

  setInterval(refreshDashboard, REFRESH_MS);

  // 版本号一变(改动生效 / 预览刷新)立刻重绘一次,不用等下一个周期
  const badge = document.getElementById('version-badge');
  if (badge && typeof MutationObserver === 'function') {
    new MutationObserver(refreshDashboard).observe(badge, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}
