/* ========================================
   app.js — 主流程 + 初始化 + 版本号徽章(不可改)
   ======================================== */

(function () {
  // 1. 渲染所有模块
  window.renderKPIs();
  window.renderChart();
  window.renderActivities();

  // 2. 时钟
  function updateClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // 3. 每 8 秒追加新活动(模拟实时)
  const sampleEvents = [
    { type: 'success', icon: '✓', text: '用户 王五 完成了支付' },
    { type: 'info', icon: '👤', text: '新访客进入首页' },
    { type: 'warning', icon: '⚠', text: '库存预警:iPhone 15' },
    { type: 'success', icon: '✓', text: '订单 #ORD-9282 已付款' },
    { type: 'info', icon: '💬', text: '客服收到新消息' },
  ];
  setInterval(() => {
    const evt = sampleEvents[Math.floor(Math.random() * sampleEvents.length)];
    evt.id = Date.now();
    evt.time = '刚刚';
    window.ACTIVITIES.unshift(evt);
    if (window.ACTIVITIES.length > 10) window.ACTIVITIES.pop();
    window.renderActivities();
  }, 8000);

  // ★ 项目内版本号徽章:每 2 秒拉一次 data/version.json
  const badgeEl = document.getElementById('version-badge');
  const badgeText = badgeEl ? badgeEl.querySelector('.version-badge-text') : null;
  let currentVer = null;
  async function pollVersion() {
    if (!badgeText) return;
    try {
      const res = await fetch('./data/version.json?_t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const v = data.version ?? 0;
      if (v !== currentVer) {
        currentVer = v;
        badgeText.textContent = 'v' + v;
        badgeEl.classList.remove('bumped');
        void badgeEl.offsetWidth;
        badgeEl.classList.add('bumped');
      }
    } catch (_) { /* 忽略 */ }
  }
  pollVersion();
  setInterval(pollVersion, 2000);
})();
