/* ========================================
   pages/settings.js — 设置页(占位)
   ======================================== */

window.Pages = window.Pages || {};

window.Pages.settings = function () {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">设置</div>
        <div class="page-subtitle">系统配置</div>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:15px;font-weight:600;margin-bottom:12px;">通知设置</h3>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" checked />
          <span>邮件通知</span>
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" />
          <span>Slack 通知</span>
        </label>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:15px;font-weight:600;margin-bottom:12px;">主题</h3>
      <div style="display:flex;gap:12px;">
        <div style="width:48px;height:48px;border-radius:8px;background:#4f46e5;cursor:pointer;border:2px solid var(--text);"></div>
        <div style="width:48px;height:48px;border-radius:8px;background:#10b981;cursor:pointer;border:2px solid transparent;"></div>
        <div style="width:48px;height:48px;border-radius:8px;background:#f59e0b;cursor:pointer;border:2px solid transparent;"></div>
        <div style="width:48px;height:48px;border-radius:8px;background:#ef4444;cursor:pointer;border:2px solid transparent;"></div>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:15px;font-weight:600;margin-bottom:12px;">关于</h3>
      <p style="font-size:13px;color:var(--text-secondary);line-height:1.7;">
        工单管理系统 v1.0<br/>
        Powered by AI 会议助手 · 演示版本
      </p>
    </div>
  `;
};
