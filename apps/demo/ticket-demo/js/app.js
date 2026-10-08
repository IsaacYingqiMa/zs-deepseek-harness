/* ========================================
   app.js — 路由 + 菜单初始化 + 版本号徽章(不可改区)
   ======================================== */

(function () {
  const container = document.getElementById('page-container');
  const menuItems = document.querySelectorAll('.menu-item');
  const badgeEl = document.getElementById('version-badge');
  const badgeText = badgeEl ? badgeEl.querySelector('.version-badge-text') : null;

  function render() {
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [page, ...args] = hash.split('/');
    const handler = window.Pages[page];

    if (!handler) {
      container.innerHTML = `<div class="card"><p>页面不存在: ${page}</p></div>`;
      return;
    }

    container.innerHTML = handler(...args);

    // 高亮当前菜单
    menuItems.forEach((el) => {
      el.classList.toggle('active', el.dataset.page === page);
    });
  }

  // ★ 版本号徽章:每 2 秒 fetch 一次 data/version.json(轻量,几乎无开销)
  let currentVer = null;
  async function pollVersion() {
    if (!badgeText) return;
    try {
      const res = await fetch('./data/version.json?_t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const v = data.version ?? 0;
      if (v !== currentVer) {
        // 版本变了 → 更新 + 闪动一下
        currentVer = v;
        badgeText.textContent = 'v' + v;
        badgeEl.classList.remove('bumped');
        // 触发 reflow 重启动画
        void badgeEl.offsetWidth;
        badgeEl.classList.add('bumped');
      }
    } catch (_) { /* 忽略网络错误 */ }
  }

  // 路由变化
  window.addEventListener('hashchange', render);

  // 初始渲染
  if (!location.hash) {
    location.hash = '#/dashboard';
  } else {
    render();
  }

  // 启动版本号轮询(2 秒一次)
  pollVersion();
  setInterval(pollVersion, 2000);
})();
