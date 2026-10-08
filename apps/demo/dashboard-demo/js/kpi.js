/* ========================================
   kpi.js — KPI 卡渲染(★ 可改)
   AI 可以:加新指标、调整布局、改数字格式化
   ======================================== */

window.renderKPIs = function () {
  const container = document.getElementById('kpi-container');
  if (!container) return;

  container.innerHTML = window.METRICS.map((m) => {
    const trendIcon = m.trendDir === 'up' ? '↑' : m.trendDir === 'down' ? '↓' : '→';
    const decimals = Number.isInteger(m.value) ? 0 : 1;
    const formatted = m.value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `
      <div class="kpi-card">
        <div class="kpi-icon">${m.icon}</div>
        <div class="kpi-label">${m.label}</div>
        <div class="kpi-value">${formatted}${m.unit}</div>
        <div class="kpi-trend ${m.trendDir}">
          <span>${trendIcon}</span>
          <span>${m.trend > 0 ? '+' : ''}${m.trend}% 较昨日</span>
        </div>
      </div>
    `;
  }).join('');
};
